// Tests del feeder de listing_match_cl (match-feeder-cl.mjs · Fase 3, H3).
//
// Correr:  node --test scraper/lib/match-feeder-cl.test.mjs
//
// Verifican la lógica del runner con block/score/upsert inyectados y cliente en
// memoria: cada par se puntúa una vez (ordenado a<b), los rejected no se
// insertan, los pares ya agrupados por Nivel 1 (mismo property_cl) se saltan, y
// las estadísticas agregan bien.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedComuna, runMatchFeederCl } from './match-feeder-cl.mjs';

function makeClient(listingsByComuna) {
  return {
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (q.startsWith('SELECT DISTINCT comuna_id')) {
        return { rows: Object.keys(listingsByComuna).map((comuna_id) => ({ comuna_id })) };
      }
      if (q.includes('FROM listings_cl WHERE is_active = true AND comuna_id')) {
        return { rows: listingsByComuna[params[0]] ?? [] };
      }
      throw new Error(`Fake client: consulta no manejada → ${q.slice(0, 60)}`);
    },
  };
}

const L = (id, extra = {}) => ({ id, latitude: -33.4, longitude: -70.5, comuna_id: 'c1', property_cl_id: null, ...extra });

test('feedComuna: puntúa cada par una vez, salta rejected y salta mismo property_cl', async () => {
  // L1 y L2 comparten property_cl 'P' (Nivel 1) → su par se salta.
  const rows = [L('L1', { property_cl_id: 'P' }), L('L2', { property_cl_id: 'P' }), L('L3')];
  const client = makeClient({ c1: rows });

  // block: todos son candidatos entre sí.
  const block = (t, pool) => pool.filter((c) => c.id !== t.id);
  // score: (L1,L3) confirmed; (L2,L3) candidate. (L1,L2) no llega a score (mismo property_cl).
  const score = (a, b) => {
    const ids = [a.id, b.id].sort().join(',');
    if (ids === 'L1,L3') return { score: 0.9, status: 'confirmed', signals: {}, explanation: 'x' };
    if (ids === 'L2,L3') return { score: 0.6, status: 'candidate', signals: {}, explanation: 'x' };
    return { score: 0.2, status: 'rejected', signals: {}, explanation: 'x' };
  };
  const upserts = [];
  const upsert = async (c, a, b, res) => upserts.push({ a, b, status: res.status });

  const stats = await feedComuna(client, 'c1', { block, score, upsert });

  assert.equal(stats.listings, 3);
  assert.equal(stats.pairs_scored, 2); // (L1,L3) y (L2,L3); (L1,L2) saltado por property_cl
  assert.equal(stats.confirmed, 1);
  assert.equal(stats.candidate, 1);
  assert.equal(stats.upserted, 2);
  // Pares ordenados a<b, sin duplicar (L1,L3)/(L3,L1)
  assert.deepEqual(upserts.map((u) => `${u.a},${u.b}`).sort(), ['L1,L3', 'L2,L3']);
});

test('feedComuna: rejected no se inserta', async () => {
  const rows = [L('A'), L('B')];
  const client = makeClient({ c1: rows });
  const block = (t, pool) => pool.filter((c) => c.id !== t.id);
  const score = () => ({ score: 0.1, status: 'rejected', signals: {}, explanation: 'x' });
  const upserts = [];
  const stats = await feedComuna(client, 'c1', { block, score, upsert: async (...a) => upserts.push(a) });

  assert.equal(stats.pairs_scored, 1);
  assert.equal(stats.rejected, 1);
  assert.equal(stats.upserted, 0);
  assert.equal(upserts.length, 0);
});

test('runMatchFeederCl: agrega varias comunas', async () => {
  const client = makeClient({
    c1: [L('A', { comuna_id: 'c1' }), L('B', { comuna_id: 'c1' })],
    c2: [L('C', { comuna_id: 'c2' }), L('D', { comuna_id: 'c2' })],
  });
  const block = (t, pool) => pool.filter((c) => c.id !== t.id);
  const score = () => ({ score: 0.8, status: 'confirmed', signals: {}, explanation: 'x' });
  const total = await runMatchFeederCl(client, { block, score, upsert: async () => {} });

  assert.equal(total.comunas, 2);
  assert.equal(total.confirmed, 2); // un par confirmado por comuna
  assert.equal(total.upserted, 2);
});

test('runMatchFeederCl: comunaIds explícitas se respetan', async () => {
  const client = makeClient({ c1: [L('A'), L('B')], c2: [L('C')] });
  const block = (t, pool) => pool.filter((c) => c.id !== t.id);
  const score = () => ({ score: 0.8, status: 'confirmed', signals: {}, explanation: 'x' });
  const total = await runMatchFeederCl(client, { comunaIds: ['c1'], block, score, upsert: async () => {} });
  assert.equal(total.comunas, 1);
  assert.equal(total.listings, 2);
});
