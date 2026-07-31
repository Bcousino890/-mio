// Tests del barrido de inventario COMPLETO de una corredora por su tienda
// oficial (discovery-corredora-tienda-cl.mjs · H23).
//
// Correr:  node --test scraper/lib/discovery-corredora-tienda-cl.test.mjs
//
// Motivación (ver cabecera del módulo): el barrido por comuna solo ve las
// comunas activadas en scrape_targets_cl; una corredora grande publica en toda
// la RM. `buildTiendaListUrl` está verificada contra HTML real de CyM
// Propiedades y Remax Diamante (ver commit); estos tests cubren la mecánica de
// paginación SIN red (fetch/parse/enqueue inyectados).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildTiendaListUrl,
  sweepCorredoraTienda,
  selectDueCorredoraSweeps,
} from './discovery-corredora-tienda-cl.mjs'

// ── buildTiendaListUrl ───────────────────────────────────────────────────────

test('primera página sin orden (sortRecent:false): URL desnuda, tipo pluralizado, región RM', () => {
  // Verificado real contra CyM Propiedades exactamente en esta forma (sin
  // ningún sufijo): HTTP 200, meta.total=506 = "506 resultados" del portal.
  assert.equal(
    buildTiendaListUrl({ storeSlug: 'cym-propiedades', propertyType: 'casa', sortRecent: false }),
    'https://www.portalinmobiliario.com/tienda/cym-propiedades/listado/inmuebles/casas/propiedades-usadas/rm-metropolitana'
  )
})

test('primera página con sortRecent por defecto: mismo criterio que buildListUrl (comuna)', () => {
  // sortRecent=true es el default (igual que el barrido por comuna) y agrega el
  // sufijo _OrderId_ incluso en offset=0 — comportamiento ya en producción vía
  // buildListUrl, aquí solo se replica.
  assert.equal(
    buildTiendaListUrl({ storeSlug: 'cym-propiedades', propertyType: 'casa' }),
    'https://www.portalinmobiliario.com/tienda/cym-propiedades/listado/inmuebles/casas/propiedades-usadas/rm-metropolitana/_OrderId_BEGINS*DESC_NoIndex_True'
  )
})

test('página 2: mismo patrón _Desde_N que el barrido por comuna', () => {
  const url = buildTiendaListUrl({ storeSlug: 'cym-propiedades', propertyType: 'casa', offset: 48 })
  assert.equal(
    url,
    'https://www.portalinmobiliario.com/tienda/cym-propiedades/listado/inmuebles/casas/propiedades-usadas/rm-metropolitana/_Desde_49_OrderId_BEGINS*DESC_NoIndex_True'
  )
})

test('con banda de precio: el filtro va en el mismo segmento que _Desde_/_OrderId_', () => {
  const url = buildTiendaListUrl({
    storeSlug: 'property-partners', propertyType: 'casa', offset: 96,
    priceRange: { min: 0, max: 15000, unit: 'CLF' },
  })
  assert.match(url, /\/_Desde_97_OrderId_BEGINS\*DESC_PriceRange_0CLF-15000CLF_NoIndex_True$/)
})

test('sin tipo: default casa (plural)', () => {
  const url = buildTiendaListUrl({ storeSlug: 'x' })
  assert.match(url, /\/casas\/propiedades-usadas\//)
})

test('no duplica la "s" si el tipo ya viene en plural', () => {
  const url = buildTiendaListUrl({ storeSlug: 'x', propertyType: 'departamentos' })
  assert.match(url, /\/departamentos\/propiedades-usadas\//)
})

// ── sweepCorredoraTienda: mecánica de paginación ────────────────────────────

function fakeMeta(total, pageCount, resultsLimit = total) {
  return { total, pageCount, resultsLimit }
}

/** Cliente de Postgres de juguete: registra llamadas, sin red ni datos reales. */
function fakeClient(existingIds = []) {
  const calls = []
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
      if (sql.includes('SELECT external_id FROM listings_cl')) {
        const ids = params[0].filter((id) => existingIds.includes(id))
        return { rows: ids.map((external_id) => ({ external_id })) }
      }
      if (sql.includes('SELECT id FROM listings_cl') && sql.includes('is_active')) return { rows: [] }
      return { rows: [] }
    },
  }
}

test('pagina hasta que una página viene vacía, sin tope artificial bajo', async () => {
  const client = fakeClient()
  const pages = {
    1: { total: 96, pageCount: 2, listings: Array.from({ length: 48 }, (_, i) => ({ external_id: `MLC-${i}`, source_url: 'u' })) },
    2: { total: 96, pageCount: 2, listings: Array.from({ length: 48 }, (_, i) => ({ external_id: `MLC-${48 + i}`, source_url: 'u' })) },
    3: { total: 96, pageCount: 2, listings: [] },
  }
  let fetchCount = 0
  const enqueued = []
  const r = await sweepCorredoraTienda(
    client,
    { id: 'c1', portal_store_slug: 'cym-propiedades' },
    {
      fetch: async (url) => {
        fetchCount++
        const page = url.includes('_Desde_97') ? 3 : url.includes('_Desde_49') ? 2 : 1
        return { ok: true, html: `<html>${page}</html>` }
      },
      parseList: (html) => pages[Number(html.match(/\d+/)[0])].listings,
      parseMeta: (html) => fakeMeta(pages[Number(html.match(/\d+/)[0])].total, pages[Number(html.match(/\d+/)[0])].pageCount),
      enqueueDetail: async (id, url) => { enqueued.push(id) },
      sleep: async () => {},
    }
  )

  assert.equal(fetchCount, 3, 'debe pedir la 3ra página vacía para confirmar el fin')
  assert.equal(r.seen, 96)
  assert.equal(enqueued.length, 96)
  assert.equal(r.completed, true)
})

test('respeta lo ya conocido: no reencola external_id ya en listings_cl', async () => {
  const client = fakeClient(['MLC-0', 'MLC-1'])
  const enqueued = []
  await sweepCorredoraTienda(
    client,
    { id: 'c1', portal_store_slug: 'x' },
    {
      // Página 1 trae los 3 anuncios; cualquier página siguiente viene vacía
      // (fin real de la paginación) — así el mock refleja un solo barrido.
      fetch: async (url) => ({ ok: true, html: url.includes('_Desde_') ? '<html>vacio</html>' : '<html>1</html>' }),
      parseList: (html) => html.includes('vacio')
        ? []
        : [{ external_id: 'MLC-0', source_url: 'u' }, { external_id: 'MLC-1', source_url: 'u' }, { external_id: 'MLC-2', source_url: 'u' }],
      parseMeta: (html) => html.includes('vacio') ? fakeMeta(3, 1) : fakeMeta(3, 1),
      enqueueDetail: async (id) => { enqueued.push(id) },
      sleep: async () => {},
    }
  )
  assert.deepEqual(enqueued, ['MLC-2'])
})

test('404 en la primera página: tienda sin inventario para este tipo, no es error', async () => {
  const client = fakeClient()
  const r = await sweepCorredoraTienda(
    client,
    { id: 'c1', portal_store_slug: 'x' },
    {
      fetch: async () => ({ ok: false, status: 404, reason: 'HTTP 404' }),
      parseList: () => [],
      parseMeta: () => fakeMeta(0, 0),
      enqueueDetail: async () => {},
      sleep: async () => {},
    }
  )
  assert.equal(r.completed, true)
  assert.equal(r.seen, 0)
})

test('página que supera el tope de paginación (capped): subdivide por precio', async () => {
  const client = fakeClient()
  // Simula una tienda con 3000 resultados (tope de una sola vista ~2000): la
  // primera pasada queda "capped" y se espera que se prueben bandas de precio.
  let probedRanges = 0
  const r = await sweepCorredoraTienda(
    client,
    { id: 'c1', portal_store_slug: 'grande' },
    {
      fetch: async (url) => {
        if (url.includes('PriceRange')) { probedRanges++; return { ok: true, html: '<html>0</html>' } }
        return { ok: true, html: '<html>0</html>' }
      },
      parseList: () => [],
      // Primera llamada (sin banda): total=3000, resultsLimit=2000 → capped.
      // Llamadas de banda: total bajo, no capped, hoja inmediata.
      parseMeta: (html) => fakeMeta(3000, 42, 2000),
      enqueueDetail: async () => {},
      sleep: async () => {},
    }
  )
  assert.ok(r.bands > 1, `esperaba subdivisión por bandas, bands=${r.bands}`)
})

test('cobertura insuficiente pese a señales de fin de paginación: no da de baja nada', async () => {
  // El portal declara 100, pero la paginación se "cierra" tras ver solo 5 (la
  // misma página se repite y decideContinue corta por racha sin nuevos). Las
  // señales de fin dicen "completo"; la cobertura real (5/100) dice que no.
  // Confiar solo en las primeras habría dado de baja 95 anuncios vivos.
  const client = fakeClient()
  const fixedFive = Array.from({ length: 5 }, (_, i) => ({ external_id: `MLC-${i}`, source_url: 'u' }))
  const r = await sweepCorredoraTienda(
    client,
    { id: 'c1', portal_store_slug: 'x' },
    {
      fetch: async () => ({ ok: true, html: '<html>x</html>' }),
      parseList: () => fixedFive,
      parseMeta: () => fakeMeta(100, 3),
      enqueueDetail: async () => {},
      sleep: async () => {},
    }
  )

  assert.equal(r.seen, 5)
  assert.equal(r.completed, false)
  assert.match(r.reason, /cobertura del barrido 5\/100/)
  assert.equal(r.delisted, 0)
  const delistQuery = client.calls.find((c) => c.sql.includes('SELECT id FROM listings_cl') && c.sql.includes('is_active'))
  assert.equal(delistQuery, undefined, 'no debe siquiera consultar qué dar de baja')
})

test('marca store_swept_at al terminar', async () => {
  const client = fakeClient()
  await sweepCorredoraTienda(
    client,
    { id: 'c1', portal_store_slug: 'x' },
    {
      fetch: async () => ({ ok: true, html: '<html>1</html>' }),
      parseList: () => [],
      parseMeta: () => fakeMeta(0, 0),
      enqueueDetail: async () => {},
      sleep: async () => {},
    }
  )
  const update = client.calls.find((c) => c.sql.includes('store_swept_at'))
  assert.ok(update, 'debe actualizar store_swept_at')
  assert.equal(update.params[0], 'c1')
})

// ── selectDueCorredoraSweeps ─────────────────────────────────────────────────

test('selectDueCorredoraSweeps pasa limit y maxAgeHours a la query', async () => {
  const client = {
    async query(sql, params) {
      return { rows: [{ id: 'c1', portal_store_slug: 'x' }], _sql: sql, _params: params }
    },
  }
  let seenParams
  client.query = async (sql, params) => { seenParams = params; return { rows: [] } }
  await selectDueCorredoraSweeps(client, { limit: 7, maxAgeHours: 12 })
  assert.deepEqual(seenParams, [7, 12])
})
