// Tests del blindaje del matching MANUAL frente al dedup Nivel 1 (dedup-cl.mjs).
//
// Correr:  node --test scraper/lib/dedup-cl-manual-lock.test.mjs
//
// Contexto (migración 0079): el equipo une/separa fichas a mano desde
// /chile/propiedades cuando el dedup no acierta. Nivel 1 agrupa por
// (advertiser_id, seller_reference) —corredora + su código interno— y REASIGNA
// la familia completa a un mismo property_cl; sin protección, separar a mano dos
// anuncios de esa familia se revertía solo en el siguiente barrido.
// `listings_cl.manual_property_lock` marca esos anuncios: no se reasignan, pero
// sí siguen contando para saber a qué ficha pertenece el grupo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNivel1DedupCl } from './dedup-cl.mjs';

const BASE = {
  operation: 'sale', property_type: 'casa', price: 500000000, price_uf: null, uf_rate: null, uf_rate_date: null,
  square_meters: 100, bedrooms: 3, bathrooms: 2, comuna_id: 'c1', localidad: null, latitude: -33.4, longitude: -70.5,
  location_confidence: 'none', exact_address: null, portal: 'portalinmobiliario', source_type: 'portal',
  advertiser_type: 'professional', advertiser_id: 'a1', is_active: true,
  first_seen_at: new Date('2026-07-20'), last_seen_at: new Date('2026-07-24'), portal_first_seen_at: null,
  manual_property_lock: false,
};

const key = (s) => String(s ?? '').trim().toLowerCase();

/**
 * Fake mínimo de pg.Client para runNivel1DedupCl: enruta por fragmentos
 * estables del SQL sobre un store en memoria y registra los UPDATE aplicados.
 */
function makeFakeClient(listings) {
  const norm = (sql) => sql.replace(/\s+/g, ' ').trim();
  const state = { listings, created: [], updates: [], nextId: 1 };
  const client = {
    state,
    async query(sql, params = []) {
      const q = norm(sql);

      // Cola de Nivel 1: grupos con algún anuncio sin agrupar y sin fijar a mano.
      if (q.startsWith('SELECT DISTINCT advertiser_id, seller_reference')) {
        const seen = new Map();
        for (const l of listings.values()) {
          if (!l.advertiser_id || !key(l.seller_reference)) continue;
          if (l.property_cl_id != null || l.manual_property_lock) continue;
          seen.set(`${l.advertiser_id}|${key(l.seller_reference)}`, {
            advertiser_id: l.advertiser_id, seller_reference: l.seller_reference,
          });
        }
        return { rows: [...seen.values()] };
      }

      // Familia por (advertiser_id, seller_reference).
      if (q.includes('FROM listings_cl') && q.includes('WHERE advertiser_id = $1')) {
        const [advertiser, ref] = params;
        return { rows: [...listings.values()].filter((l) => l.advertiser_id === advertiser && key(l.seller_reference) === key(ref)) };
      }

      // Segunda pasada: anuncios que quedaron sin property_cl → ficha propia.
      if (q.includes('FROM listings_cl') && q.includes('WHERE property_cl_id IS NULL')) {
        return { rows: [...listings.values()].filter((l) => l.property_cl_id == null) };
      }

      // Consolidación al refrescar agregados.
      if (q.includes('FROM listings_cl WHERE property_cl_id = $1')) {
        return { rows: [...listings.values()].filter((l) => l.property_cl_id === params[0]) };
      }

      if (q.startsWith('INSERT INTO property_cl')) {
        const id = `P${state.nextId++}`;
        state.created.push(id);
        return { rows: [{ id }] };
      }

      if (q.startsWith('UPDATE listings_cl SET property_cl_id')) {
        const respectsLock = q.includes('NOT manual_property_lock');
        const byId = q.includes('id = $2');
        const [propertyClId, target] = params;
        const ids = byId ? [target] : target;
        const touched = [];
        for (const id of ids) {
          const l = listings.get(id);
          if (!l || l.property_cl_id === propertyClId) continue;
          if (byId && l.property_cl_id != null) continue; // ... AND property_cl_id IS NULL
          if (respectsLock && l.manual_property_lock) continue;
          l.property_cl_id = propertyClId;
          touched.push(id);
        }
        state.updates.push({ propertyClId, touched });
        return { rowCount: touched.length, rows: [] };
      }

      if (q.startsWith('UPDATE property_cl SET')) return { rowCount: 1, rows: [] };

      throw new Error(`SQL no cubierto por el fake: ${q.slice(0, 80)}`);
    },
  };
  return client;
}

const listingsMap = (rows) => new Map(rows.map((r) => [r.id, { ...BASE, ...r }]));

test('Nivel 1 no re-agrupa un anuncio separado a mano aunque comparta corredora y código interno', async () => {
  // L1 y L2 son la misma publicación de la misma corredora; el equipo sacó L2 a
  // una ficha propia (property Q, manual_property_lock). Llega L3, sin agrupar.
  const listings = listingsMap([
    { id: 'L1', advertiser_id: 'a1', seller_reference: 'BV3535', property_cl_id: 'P', manual_property_lock: false },
    { id: 'L2', advertiser_id: 'a1', seller_reference: 'BV3535', property_cl_id: 'Q', manual_property_lock: true },
    { id: 'L3', advertiser_id: 'a1', seller_reference: 'bv3535', property_cl_id: null, manual_property_lock: false },
  ]);
  const client = makeFakeClient(listings);

  await runNivel1DedupCl(client);

  assert.equal(listings.get('L2').property_cl_id, 'Q', 'el anuncio separado a mano sigue en su ficha');
  assert.equal(listings.get('L3').property_cl_id, 'P', 'la republicación cae en la ficha automática del grupo');
  assert.deepEqual(client.state.created, [], 'no se crea una ficha paralela');
});

test('Nivel 1 suma la republicación a la ficha curada cuando el resto del grupo está fijado a mano', async () => {
  const listings = listingsMap([
    { id: 'L1', advertiser_id: 'a1', seller_reference: 'AB-1', property_cl_id: 'M', manual_property_lock: true },
    { id: 'L2', advertiser_id: 'a1', seller_reference: 'AB-1', property_cl_id: null, manual_property_lock: false },
  ]);
  const client = makeFakeClient(listings);

  await runNivel1DedupCl(client);

  assert.equal(listings.get('L2').property_cl_id, 'M');
  assert.deepEqual(client.state.created, []);
});

test('Nivel 1 sigue creando la ficha cuando el grupo no tiene nada fijado a mano', async () => {
  const listings = listingsMap([
    { id: 'L1', advertiser_id: 'a1', seller_reference: 'CD-9', property_cl_id: null },
    { id: 'L2', advertiser_id: 'a1', seller_reference: 'CD-9', property_cl_id: null },
  ]);
  const client = makeFakeClient(listings);

  await runNivel1DedupCl(client);

  assert.equal(client.state.created.length, 1);
  assert.equal(listings.get('L1').property_cl_id, client.state.created[0]);
  assert.equal(listings.get('L2').property_cl_id, client.state.created[0]);
});

test('un grupo enteramente fijado a mano ni siquiera entra a la cola de Nivel 1', async () => {
  const listings = listingsMap([
    { id: 'L1', advertiser_id: 'a1', seller_reference: 'EF-2', property_cl_id: 'M', manual_property_lock: true },
    { id: 'L2', advertiser_id: 'a1', seller_reference: 'EF-2', property_cl_id: 'N', manual_property_lock: true },
  ]);
  const client = makeFakeClient(listings);

  const stats = await runNivel1DedupCl(client);

  assert.equal(stats.groups_processed, 0);
  assert.equal(listings.get('L1').property_cl_id, 'M');
  assert.equal(listings.get('L2').property_cl_id, 'N');
});
