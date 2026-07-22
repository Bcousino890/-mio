// Tests del Nivel 2 de dedup chilena (clustering-cl.mjs, plan Anuncios CL · H3).
//
// Correr:  node --test scraper/lib/clustering-cl.test.mjs
//
// La lógica de decisión (componentes, superviviente, plan de merge,
// re-partición black-hole) se testea PURA, sin Postgres. Un último test cablea
// runNivel2ClusteringCl contra un cliente pg EN MEMORIA (fake) para verificar el
// caso central del plan: dos property_cl de Nivel 1 (corredoras distintas)
// fusionados en uno, con borrado del huérfano y confianzas Nivel 2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  connectedComponentsFromEdges,
  maxIncidentScoreByNode,
  chooseSurvivorPropertyCl,
  planComponentMerge,
  repartitionComponent,
  runNivel2ClusteringCl,
} from './clustering-cl.mjs';

// ── Funciones puras ──────────────────────────────────────────────────────────

test('connectedComponentsFromEdges agrupa por transitividad', () => {
  const comps = connectedComponentsFromEdges([
    { a: 'L1', b: 'L2', score: 0.9 },
    { a: 'L2', b: 'L3', score: 0.8 },
    { a: 'L4', b: 'L5', score: 0.95 },
  ]);
  assert.equal(comps.length, 2);
  const sorted = comps.map((c) => c.sort()).sort((x, y) => x[0].localeCompare(y[0]));
  assert.deepEqual(sorted[0], ['L1', 'L2', 'L3']);
  assert.deepEqual(sorted[1], ['L4', 'L5']);
});

test('connectedComponentsFromEdges ignora self-loops y aristas duplicadas', () => {
  const comps = connectedComponentsFromEdges([
    { a: 'L1', b: 'L1', score: 0.9 },
    { a: 'L1', b: 'L2', score: 0.9 },
    { a: 'L1', b: 'L2', score: 0.7 },
  ]);
  assert.equal(comps.length, 1);
  assert.deepEqual(comps[0].sort(), ['L1', 'L2']);
});

test('maxIncidentScoreByNode toma la mejor arista de cada nodo', () => {
  const m = maxIncidentScoreByNode([
    { a: 'L1', b: 'L2', score: 0.8 },
    { a: 'L2', b: 'L3', score: 0.95 },
  ]);
  assert.equal(m.get('L1'), 0.8);
  assert.equal(m.get('L2'), 0.95);
  assert.equal(m.get('L3'), 0.95);
});

test('chooseSurvivorPropertyCl prioriza más listings, luego más antiguo, luego id', () => {
  assert.equal(
    chooseSurvivorPropertyCl([
      { id: 'P-small', listing_count: 1, created_at: '2026-01-01' },
      { id: 'P-big', listing_count: 5, created_at: '2026-02-01' },
    ]),
    'P-big'
  );
  // empate en listings → gana el más antiguo
  assert.equal(
    chooseSurvivorPropertyCl([
      { id: 'P-new', listing_count: 3, created_at: '2026-05-01' },
      { id: 'P-old', listing_count: 3, created_at: '2026-01-01' },
    ]),
    'P-old'
  );
  // empate total → gana id lexicográfico estable
  assert.equal(
    chooseSurvivorPropertyCl([
      { id: 'Pb', listing_count: 2, created_at: '2026-01-01' },
      { id: 'Pa', listing_count: 2, created_at: '2026-01-01' },
    ]),
    'Pa'
  );
  assert.equal(chooseSurvivorPropertyCl([]), null);
});

test('planComponentMerge fusiona 2 property_cl de Nivel 1 en el superviviente', () => {
  // Corredora A: property_cl P-A con listings LA1, LA2 (LA1 es nodo puente).
  // Corredora B: property_cl P-B con listing LB1 (nodo puente).
  // La arista confirmada conecta LA1–LB1.
  const plan = planComponentMerge({
    componentNodes: ['LA1', 'LB1'],
    propertyClIdByListing: new Map([
      ['LA1', 'P-A'], ['LA2', 'P-A'], ['LB1', 'P-B'],
    ]),
    listingsByPropertyCl: new Map([
      ['P-A', ['LA1', 'LA2']], ['P-B', ['LB1']],
    ]),
    propertyClMeta: [
      { id: 'P-A', listing_count: 2, created_at: '2026-01-01' },
      { id: 'P-B', listing_count: 1, created_at: '2026-02-01' },
    ],
    incidentScoreByNode: new Map([['LA1', 0.82], ['LB1', 0.82]]),
  });

  assert.equal(plan.survivorId, 'P-A'); // más listings
  assert.equal(plan.createSurvivor, false);
  assert.deepEqual(plan.deletePropertyClIds, ['P-B']); // huérfano tras mover LB1
  assert.deepEqual([...plan.familyListingIds].sort(), ['LA1', 'LA2', 'LB1']);

  // LA1 y LB1 son nodos del grafo → confianza Nivel 2 (0.82).
  // LA2 fue arrastrado por compartir P-A → confidence null (no se le toca).
  const byListing = new Map(plan.reassign.map((r) => [r.listingId, r.confidence]));
  assert.equal(byListing.get('LA1'), 0.82);
  assert.equal(byListing.get('LB1'), 0.82);
  assert.equal(byListing.get('LA2'), null);
});

test('planComponentMerge crea superviviente si ningún nodo tenía property_cl', () => {
  const plan = planComponentMerge({
    componentNodes: ['X1', 'X2'],
    propertyClIdByListing: new Map([['X1', null], ['X2', null]]),
    listingsByPropertyCl: new Map(),
    propertyClMeta: [],
    incidentScoreByNode: new Map([['X1', 0.9], ['X2', 0.9]]),
  });
  assert.equal(plan.survivorId, null);
  assert.equal(plan.createSurvivor, true);
  assert.deepEqual(plan.deletePropertyClIds, []);
  assert.deepEqual(plan.familyListingIds.sort(), ['X1', 'X2']);
});

test('repartitionComponent parte por score estricto y deja solos a los no-cubiertos', () => {
  // L1–L2 fuerte (0.95), L2–L3 débil (0.80). Con strict 0.9, L3 queda solo.
  const subs = repartitionComponent(
    ['L1', 'L2', 'L3'],
    [
      { a: 'L1', b: 'L2', score: 0.95 },
      { a: 'L2', b: 'L3', score: 0.8 },
    ],
    0.9
  );
  const norm = subs.map((s) => s.sort()).sort((x, y) => x.length - y.length || x[0].localeCompare(y[0]));
  assert.deepEqual(norm, [['L3'], ['L1', 'L2']]);
});

test('repartitionComponent sin aristas estrictas deja cada nodo solo', () => {
  const subs = repartitionComponent(
    ['L1', 'L2'],
    [{ a: 'L1', b: 'L2', score: 0.5 }],
    0.9
  );
  assert.equal(subs.length, 2);
});

// ── Integración con cliente pg EN MEMORIA ────────────────────────────────────

/**
 * Fake mínimo de pg.Client: enruta por fragmentos estables del SQL sobre un
 * store en memoria. Solo cubre las consultas que emite runNivel2ClusteringCl +
 * refreshPropertyClAggregates.
 */
function makeFakeClient({ listings, propertyCl, matches }) {
  const norm = (sql) => sql.replace(/\s+/g, ' ').trim();
  return {
    async query(sql, params = []) {
      const q = norm(sql);

      if (q.includes('FROM listing_match_cl')) {
        const minScore = params[0];
        return {
          rows: matches
            .filter((m) => m.status === 'confirmed' && m.score >= minScore)
            .map((m) => ({ a: m.a, b: m.b, score: m.score })),
        };
      }

      // SELECT id, property_cl_id FROM listings_cl WHERE id = ANY(...)
      if (q.startsWith('SELECT id, property_cl_id FROM listings_cl WHERE id = ANY')) {
        const ids = params[0];
        return { rows: ids.filter((id) => listings.has(id)).map((id) => ({ id, property_cl_id: listings.get(id).property_cl_id })) };
      }

      // SELECT id, property_cl_id FROM listings_cl WHERE property_cl_id = ANY(...)
      if (q.startsWith('SELECT id, property_cl_id FROM listings_cl WHERE property_cl_id = ANY')) {
        const pids = new Set(params[0]);
        return { rows: [...listings.values()].filter((l) => pids.has(l.property_cl_id)).map((l) => ({ id: l.id, property_cl_id: l.property_cl_id })) };
      }

      // SELECT id, listing_count, created_at FROM property_cl WHERE id = ANY(...)
      if (q.includes('listing_count, created_at FROM property_cl WHERE id = ANY')) {
        const ids = params[0];
        return { rows: ids.filter((id) => propertyCl.has(id)).map((id) => ({ id, ...propertyCl.get(id) })) };
      }

      // Consolidación: SELECT <muchos campos incl operation> FROM listings_cl WHERE ...
      if (q.includes('operation') && q.includes('FROM listings_cl')) {
        const isAnyById = q.includes('WHERE id = ANY');
        const rows = isAnyById
          ? params[0].map((id) => listings.get(id)).filter(Boolean)
          : [...listings.values()].filter((l) => l.property_cl_id === params[0]);
        return { rows };
      }

      if (q.startsWith('INSERT INTO property_cl')) {
        const id = `P-new-${propertyCl.size + 1}`;
        propertyCl.set(id, { listing_count: 0, created_at: new Date().toISOString() });
        return { rows: [{ id }] };
      }

      // UPDATE listings_cl con match_confidence (nodo del grafo)
      if (q.startsWith('UPDATE listings_cl') && q.includes('match_confidence = $2')) {
        const [pid, conf, id] = params;
        const l = listings.get(id);
        if (l && (l.property_cl_id !== pid || l.match_confidence !== conf)) {
          l.property_cl_id = pid;
          l.match_confidence = conf;
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      }

      // UPDATE listings_cl arrastrados (sin tocar confidence), id = ANY
      if (q.startsWith('UPDATE listings_cl') && q.includes('property_cl_id = $1') && q.includes('id = ANY')) {
        const [pid, ids] = params;
        let n = 0;
        for (const id of ids) {
          const l = listings.get(id);
          if (l && l.property_cl_id !== pid) { l.property_cl_id = pid; n++; }
        }
        return { rowCount: n };
      }

      // Chequeo de huérfanos
      if (q.includes('NOT EXISTS') && q.includes('property_cl')) {
        const ids = params[0];
        const orphans = ids.filter((id) => ![...listings.values()].some((l) => l.property_cl_id === id));
        return { rows: orphans.map((id) => ({ id })) };
      }

      if (q.startsWith('DELETE FROM property_cl')) {
        const ids = params[0];
        let n = 0;
        for (const id of ids) if (propertyCl.delete(id)) n++;
        return { rowCount: n };
      }

      // refreshPropertyClAggregates UPDATE property_cl SET ...
      if (q.startsWith('UPDATE property_cl SET')) {
        const pid = params[0];
        const p = propertyCl.get(pid);
        if (p) p.listing_count = [...listings.values()].filter((l) => l.property_cl_id === pid).length;
        return { rowCount: 1 };
      }

      throw new Error(`Fake client: consulta no manejada → ${q.slice(0, 90)}`);
    },
  };
}

function baseListing(id, overrides = {}) {
  return {
    id, property_cl_id: null, match_confidence: null,
    operation: 'sale', property_type: 'house', price: 100000000, price_uf: null,
    uf_rate: null, uf_rate_date: null, square_meters: 100, bedrooms: 3, bathrooms: 2,
    comuna_id: 'c1', localidad: null, latitude: -33.4, longitude: -70.6,
    location_confidence: 'candidate', exact_address: null, portal: 'portalinmobiliario',
    source_type: 'portal', advertiser_type: 'professional', advertiser_id: 'seller-x',
    is_active: true, first_seen_at: '2026-01-01', last_seen_at: '2026-01-10',
    ...overrides,
  };
}

test('runNivel2ClusteringCl fusiona dos property_cl de corredoras distintas', async () => {
  const listings = new Map([
    ['LA1', baseListing('LA1', { property_cl_id: 'P-A', match_confidence: 1, advertiser_id: 'A' })],
    ['LA2', baseListing('LA2', { property_cl_id: 'P-A', match_confidence: 1, advertiser_id: 'A' })],
    ['LB1', baseListing('LB1', { property_cl_id: 'P-B', match_confidence: 1, advertiser_id: 'B' })],
  ]);
  const propertyCl = new Map([
    ['P-A', { listing_count: 2, created_at: '2026-01-01' }],
    ['P-B', { listing_count: 1, created_at: '2026-02-01' }],
  ]);
  const matches = [{ a: 'LA1', b: 'LB1', score: 0.82, status: 'confirmed' }];
  const client = makeFakeClient({ listings, propertyCl, matches });

  const res = await runNivel2ClusteringCl(client);

  assert.equal(res.edges, 1);
  assert.equal(res.components, 1);
  assert.equal(res.merged, 1);
  assert.equal(res.created, 0);
  assert.equal(res.deleted, 1); // P-B borrado (huérfano)

  // Todos apuntan al superviviente P-A.
  assert.equal(listings.get('LA1').property_cl_id, 'P-A');
  assert.equal(listings.get('LA2').property_cl_id, 'P-A');
  assert.equal(listings.get('LB1').property_cl_id, 'P-A');
  assert.equal(propertyCl.has('P-B'), false);

  // Nodos del grafo con confianza Nivel 2; el arrastrado (LA2) conserva su 1.
  assert.equal(listings.get('LA1').match_confidence, 0.82);
  assert.equal(listings.get('LB1').match_confidence, 0.82);
  assert.equal(listings.get('LA2').match_confidence, 1);

  // Idempotencia: segunda corrida no vuelve a fusionar ni borra nada.
  const res2 = await runNivel2ClusteringCl(client);
  assert.equal(res2.merged, 0);
  assert.equal(res2.deleted, 0);
  assert.equal(res2.created, 0);
});

test('runNivel2ClusteringCl sin confirmados es un no-op', async () => {
  const client = makeFakeClient({ listings: new Map(), propertyCl: new Map(), matches: [] });
  const res = await runNivel2ClusteringCl(client);
  assert.deepEqual(res, { edges: 0, components: 0, merged: 0, created: 0, deleted: 0, relinked: 0 });
});
