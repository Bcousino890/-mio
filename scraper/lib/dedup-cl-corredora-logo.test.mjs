// Tests del logo de corredora en runCorredoraConsolidationCl (dedup-cl.mjs).
//
// Correr:  node --test scraper/lib/dedup-cl-corredora-logo.test.mjs
//
// El logo (advertiser_logo, persistido en listings_cl desde 0075) se propaga a
// corredoras_cl.logo_url con el mismo criterio que el nombre: el más reciente no
// nulo entre los anuncios de la corredora. Cubre además el backfill de una
// corredora YA existente que se creó antes de este fix (sin logo) y que no debe
// pisar un logo ya guardado en corridas siguientes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCorredoraConsolidationCl } from './dedup-cl.mjs';

function makeClient({ pendingAdvertiserIds, family, existingCorredora = null }) {
  const state = { inserted: null, updates: [] };
  return {
    state,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (q.startsWith('SELECT DISTINCT advertiser_id')) {
        return { rows: pendingAdvertiserIds.map((advertiser_id) => ({ advertiser_id })) };
      }
      if (q.startsWith('SELECT id, corredora_id, advertiser_name, advertiser_logo')) {
        return { rows: family };
      }
      if (q.startsWith('INSERT INTO corredoras_cl')) {
        state.inserted = { sql: q, params };
        return { rows: [{ id: existingCorredora?.id ?? 'corredora-1' }] };
      }
      if (q.startsWith('UPDATE corredoras_cl SET logo_url')) {
        state.updates.push({ id: params[0], logo: params[1] });
        return { rowCount: 1 };
      }
      if (q.startsWith('UPDATE listings_cl SET corredora_id')) return { rowCount: family.length };
      if (q.startsWith('SELECT l.phone')) return { rows: [] }; // refreshCorredoraMetrics
      if (q.startsWith('UPDATE corredoras_cl SET') && q.includes('phones =')) return { rowCount: 1 };
      return { rows: [] };
    },
  };
}

const L = (id, extra = {}) => ({
  id, corredora_id: null, advertiser_name: 'Ascui Propiedades', advertiser_logo: null,
  phone: null, comuna_id: 'c1', is_active: true,
  first_seen_at: '2026-01-01', last_seen_at: '2026-01-01', taken_down_at: null, property_cl_id: null,
  ...extra,
});

test('crea la corredora con el logo más reciente no nulo entre sus anuncios', async () => {
  const family = [
    L('l1', { advertiser_logo: null, last_seen_at: '2026-01-01' }),
    L('l2', { advertiser_logo: 'https://.../old.jpg', last_seen_at: '2026-01-02' }),
    L('l3', { advertiser_logo: 'https://.../new.jpg', last_seen_at: '2026-01-05' }), // el más reciente
  ];
  const client = makeClient({ pendingAdvertiserIds: ['adv-1'], family });
  const res = await runCorredoraConsolidationCl(client);

  assert.equal(res.created, 1);
  assert.ok(client.state.inserted.sql.includes('logo_url'));
  assert.ok(client.state.inserted.params.includes('https://.../new.jpg'));
});

test('corredora YA existente sin logo: se rellena (backfill)', async () => {
  const family = [
    L('l1', { corredora_id: 'corredora-existente', advertiser_logo: 'https://.../logo.jpg' }),
  ];
  const client = makeClient({ pendingAdvertiserIds: ['adv-2'], family });
  await runCorredoraConsolidationCl(client);

  assert.equal(client.state.updates.length, 1);
  assert.equal(client.state.updates[0].id, 'corredora-existente');
  assert.equal(client.state.updates[0].logo, 'https://.../logo.jpg');
});

test('corredora ya existente SIN logo disponible en sus anuncios: no intenta update', async () => {
  const family = [
    L('l1', { corredora_id: 'corredora-existente', advertiser_logo: null }),
  ];
  const client = makeClient({ pendingAdvertiserIds: ['adv-3'], family });
  await runCorredoraConsolidationCl(client);

  assert.equal(client.state.updates.length, 0);
});
