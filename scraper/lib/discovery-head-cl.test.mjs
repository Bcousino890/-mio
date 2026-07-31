// Tests del barrido de CABECERA (altas) — scanHeadTarget.
//
// Correr:  node --test scraper/lib/discovery-head-cl.test.mjs
//
// El barrido completo recorre la comuna entera con bandas de precio porque para
// saber qué se DIO DE BAJA hay que verlo todo. Para detectar ALTAS no: el
// listado se pide ordenado por más reciente, así que lo nuevo está arriba.
// Barrer entero cada 30 min costaría ~200x más tráfico para descubrir lo mismo.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanHeadTarget } from './discovery-portalinmobiliario-cl.mjs'

const TARGET = { id: 't1', comuna_name: 'Las Condes', region: 'Metropolitana', operation: 'sale', property_type: 'casa' }

/** Portal falso: `paginas[i]` son los external_id de la página i+1. */
function makeDeps({ paginas, conocidos = new Set() }) {
  const urls = []
  const encolados = []
  return {
    urls, encolados,
    deps: {
      fetch: async (url) => { urls.push(url); const i = urls.length - 1; return i < paginas.length ? { ok: true, html: `p${i}` } : { ok: false, status: 404 } },
      parseList: (html) => (paginas[Number(html.slice(1))] ?? []).map((id) => ({ external_id: id, source_url: `https://x/${id}`, is_development: false })),
      parseMeta: () => ({ total: 3471, resultsLimit: 2000, pageCount: 99 }),
      enqueueDetail: async (id, url) => { encolados.push(id) },
      sleep: async () => {},
      politenessMs: 0,
    },
    client: {
      async query(_sql, params) {
        const ids = params[0] ?? []
        return { rows: ids.filter((i) => conocidos.has(i)).map((external_id) => ({ external_id })) }
      },
    },
  }
}

test('se queda en UNA página si ya conoce alguno: lo de más abajo es más antiguo', async () => {
  const { deps, client, urls, encolados } = makeDeps({
    paginas: [['A', 'B', 'C'], ['D', 'E']],
    conocidos: new Set(['B', 'C']),
  })
  const res = await scanHeadTarget(client, TARGET, deps)
  assert.equal(res.pages, 1)
  assert.equal(urls.length, 1)          // no baja la segunda página
  assert.deepEqual(encolados, ['A'])    // solo encola la que no conocía
})

test('baja otra página solo si TODOS los avisos eran nuevos', async () => {
  // Día movido: la primera página entera es nueva, así que puede haber más
  // altas debajo.
  const { deps, client, urls, encolados } = makeDeps({
    paginas: [['A', 'B'], ['C', 'D'], ['E', 'F']],
    conocidos: new Set(['D']),
  })
  const res = await scanHeadTarget(client, TARGET, deps)
  assert.equal(res.pages, 2)
  assert.deepEqual(encolados, ['A', 'B', 'C'])
})

test('respeta el tope de páginas aunque todo siga siendo nuevo', async () => {
  const { deps, client } = makeDeps({ paginas: [['A'], ['B'], ['C'], ['D'], ['E']] })
  const res = await scanHeadTarget(client, TARGET, { ...deps, maxPages: 3 })
  assert.equal(res.pages, 3)
})

test('pide el listado ordenado por más reciente, que es lo que pone las altas arriba', async () => {
  const { deps, client, urls } = makeDeps({ paginas: [['A']], conocidos: new Set(['A']) })
  await scanHeadTarget(client, TARGET, deps)
  assert.match(urls[0], /_OrderId_BEGINS\*DESC/)
})

test('no revienta si el portal responde 404 (comuna sin inventario)', async () => {
  const { deps, client } = makeDeps({ paginas: [] })
  const res = await scanHeadTarget(client, TARGET, deps)
  assert.equal(res.pages, 0)
  assert.equal(res.enqueued, 0)
  assert.match(res.reason, /404/)
})

test('NUNCA da de baja: no toca la base más que para consultar los conocidos', async () => {
  // Un barrido de cabecera ve 48 avisos de una comuna de 3.471. Si de ahí
  // dedujera bajas, borraría media comuna en cada pasada.
  const escrituras = []
  const { deps, client } = makeDeps({ paginas: [['A']], conocidos: new Set() })
  const espia = { async query(sql, params) { escrituras.push(sql); return client.query(sql, params) } }
  await scanHeadTarget(espia, TARGET, deps)
  for (const sql of escrituras) {
    assert.doesNotMatch(sql, /UPDATE|DELETE|INSERT/i)
  }
})

// ─── ventana horaria de las altas ────────────────────────────────────────────

import { handleDiscoveryHeadSchedulerJob, VENTANA_ALTAS } from '../worker-cl.mjs'

const enHora = (h) => new Date(Date.UTC(2026, 6, 31, h + 4, 0, 0)) // Chile = UTC-4

test('dentro de la ventana chilena encola todos los objetivos activos', async () => {
  const encolados = []
  const res = await handleDiscoveryHeadSchedulerJob({}, {
    select: async () => [{ id: 't1' }, { id: 't2' }],
    enqueueHead: async (t) => encolados.push(t.id),
    now: () => enHora(10),
  })
  assert.equal(res.enqueued, 2)
  assert.deepEqual(encolados, ['t1', 't2'])
})

test('de madrugada no corre: no hay altas que descubrir y cada pasada cuesta proxy', async () => {
  const encolados = []
  const res = await handleDiscoveryHeadSchedulerJob({}, {
    select: async () => [{ id: 't1' }],
    enqueueHead: async (t) => encolados.push(t.id),
    now: () => enHora(3),
  })
  assert.equal(res.enqueued, 0)
  assert.match(res.skipped, /fuera de ventana/)
  assert.deepEqual(encolados, [])
})

test('los bordes de la ventana son los acordados: entra a las 8, sale a las 23', async () => {
  const corre = async (h) => (await handleDiscoveryHeadSchedulerJob({}, {
    select: async () => [{ id: 't1' }], enqueueHead: async () => {}, now: () => enHora(h),
  })).enqueued > 0
  assert.equal(VENTANA_ALTAS.desde, 8)
  assert.equal(VENTANA_ALTAS.hasta, 23)
  assert.equal(await corre(7), false)
  assert.equal(await corre(8), true)
  assert.equal(await corre(22), true)
  assert.equal(await corre(23), false)
})
