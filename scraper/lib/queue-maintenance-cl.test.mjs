// Tests de queue-maintenance-cl.mjs (limpieza de colas de pg-boss).
//
// Correr:  node --test scraper/lib/queue-maintenance-cl.test.mjs
//
// Blinda el atasco encontrado en producción: detail-cl acumuló 46.797 jobs
// PENDIENTES para ~3.700 anuncios reales (≈14 barridos apilados) porque
// `boss.send` crea un job nuevo en cada llamada. Con ese atasco, un anuncio
// nuevo quedaba enterrado días detrás de sus propios duplicados y el contador
// de anuncios crudos no subía pese a que el barrido reportaba miles de vistos.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pruneDuplicateJobsCl, prioritizeMissingDetailJobsCl } from './queue-maintenance-cl.mjs'

/** Cliente falso: registra las consultas y devuelve el rowCount programado. */
function fakeClient(rowCountByQueue) {
  const queries = []
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
      const [queue] = params
      const n = rowCountByQueue[queue]
      if (n instanceof Error) throw n
      return { rowCount: n ?? 0 }
    },
  }
}

test('pruneDuplicateJobsCl: borra duplicados por cola y devuelve el recuento', async () => {
  const client = fakeClient({ 'detail-cl': 45_797, 'media-sync-cl': 67_834 })
  const res = await pruneDuplicateJobsCl(client)

  assert.deepEqual(res, { 'detail-cl': 45_797, 'media-sync-cl': 67_834 })
  assert.equal(client.queries.length, 2)
  // Cada cola se deduplica por SU campo identificador.
  assert.deepEqual(client.queries[0].params, ['detail-cl', 'externalId'])
  assert.deepEqual(client.queries[1].params, ['media-sync-cl', 'listingId'])
})

test('pruneDuplicateJobsCl: solo toca los PENDIENTES, nunca los que se están ejecutando', async () => {
  // Un DELETE que alcanzase a los 'active' abortaría trabajo en vuelo, y sobre
  // 'completed' destruiría el histórico.
  const client = fakeClient({ 'detail-cl': 0, 'media-sync-cl': 0 })
  await pruneDuplicateJobsCl(client)
  for (const q of client.queries) {
    assert.match(q.sql, /state = 'created'/)
    assert.doesNotMatch(q.sql, /'active'|'completed'|'failed'/)
  }
})

test('pruneDuplicateJobsCl: conserva UNO por entidad (rn > 1)', async () => {
  const client = fakeClient({ 'detail-cl': 0, 'media-sync-cl': 0 })
  await pruneDuplicateJobsCl(client)
  // row_number() por entidad, borrando a partir del segundo: deja siempre 1.
  assert.match(client.queries[0].sql, /row_number\(\) OVER \( PARTITION BY data->>\$2/)
  assert.match(client.queries[0].sql, /WHERE t\.rn > 1/)
})

test('pruneDuplicateJobsCl: un fallo de una cola no tumba el pipeline que la invoca', async () => {
  // pg-boss puede no haber creado aún su esquema, o cambiar de versión: esto
  // corre dentro del job de dedup, que no puede caerse por una limpieza.
  const client = fakeClient({
    'detail-cl': new Error('relation "pgboss.job" does not exist'),
    'media-sync-cl': 12,
  })
  const res = await pruneDuplicateJobsCl(client)
  assert.match(String(res['detail-cl']), /error: relation "pgboss.job" does not exist/)
  assert.equal(res['media-sync-cl'], 12) // la otra cola sí se limpió
})

test('pruneDuplicateJobsCl: acepta un mapa de colas a medida', async () => {
  const client = fakeClient({ 'otra-cola': 3 })
  const res = await pruneDuplicateJobsCl(client, { 'otra-cola': 'miId' })
  assert.deepEqual(res, { 'otra-cola': 3 })
  assert.deepEqual(client.queries[0].params, ['otra-cola', 'miId'])
})

// ─── prioridad de los anuncios que faltan ────────────────────────────────────

test('prioritizeMissingDetailJobsCl: adelanta SOLO los pendientes que aún no están en la base', async () => {
  // pg-boss sirve por prioridad y, a igualdad, por antigüedad. La cola arrastra
  // miles de jobs viejos que solo REFRESCAN anuncios ya guardados; los que de
  // verdad faltan se encolaron después y quedaban al final. Medido en
  // producción: la cola bajaba de 3.475 a 3.416 sin una sola alta.
  let sql = null, params = null
  const client = { async query(s, p) { sql = s.replace(/\s+/g, ' ').trim(); params = p; return { rowCount: 1005 } } }

  const res = await prioritizeMissingDetailJobsCl(client)
  assert.deepEqual(res, { prioritized: 1005 })
  assert.deepEqual(params, [100])
  // Solo pendientes: nunca reordena lo que ya se está ejecutando.
  assert.match(sql, /state = 'created'/)
  // Solo los que NO están en listings_cl.
  assert.match(sql, /NOT EXISTS/)
  assert.match(sql, /listings_cl/)
  // Idempotente: no reescribe los que ya tienen la prioridad correcta.
  assert.match(sql, /priority < \$1/)
})

test('prioritizeMissingDetailJobsCl: un fallo no tumba el pipeline que lo invoca', async () => {
  const client = { async query() { throw new Error('pgboss.job no existe') } }
  const res = await prioritizeMissingDetailJobsCl(client)
  assert.match(res.error, /pgboss\.job no existe/)
})
