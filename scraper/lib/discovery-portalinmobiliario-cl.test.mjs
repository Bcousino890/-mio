// Tests del discovery crawler (discovery-portalinmobiliario-cl.mjs · H1, Fase 1).
//
// Correr:  node --test scraper/lib/discovery-portalinmobiliario-cl.test.mjs
//
// Las funciones de URL/terminación son puras. discoverTarget se testea con
// fetch/parse/enqueue/cliente EN MEMORIA — sin red ni Postgres — verificando el
// barrido: paginación, filtro de proyectos, encolado SOLO de lo nuevo, detección
// de bajas en barrido completo y actualización de stats del target.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  operationSlug,
  comunaSlug,
  regionSlug,
  buildListUrl,
  comunaMatchRatio,
  decideContinue,
  discoverTarget,
  subdividePriceBands,
} from './discovery-portalinmobiliario-cl.mjs'

// ── Puras ────────────────────────────────────────────────────────────────────

test('operationSlug / comunaSlug / regionSlug', () => {
  assert.equal(operationSlug('sale'), 'venta')
  assert.equal(operationSlug('rent'), 'arriendo')
  assert.equal(comunaSlug('Las Condes'), 'las-condes')
  assert.equal(comunaSlug('Ñuñoa'), 'nunoa')
  assert.equal(comunaSlug('La Reina'), 'la-reina')
  assert.equal(regionSlug('Región Metropolitana de Santiago'), 'metropolitana')
  // Fuera de la RM el portal quita el prefijo "Región de/del" pero CONSERVA el
  // artículo. Verificado en vivo (2026-07-28): `pucon-la-araucania` → 726
  // resultados; `pucon-araucania` (lo que devolvía la versión que se quedaba con
  // la última palabra) → 63.017, o sea el listado nacional SIN filtrar.
  assert.equal(regionSlug('Región de Valparaíso'), 'valparaiso')
  assert.equal(regionSlug('Región de la Araucanía'), 'la-araucania')
  assert.equal(regionSlug('Región de Los Lagos'), 'los-lagos')
  assert.equal(regionSlug('Región del Biobío'), 'biobio')
  // Comuna cuya grafía en el portal ("Tiltil") no es la oficial ("Til Til"):
  // el slug de URL sí es el separado — verificado, 115 resultados.
  assert.equal(comunaSlug('Til Til'), 'til-til')
})

test('comunaMatchRatio: distingue una comuna real del listado nacional sin filtrar', () => {
  const deLasCondes = [
    { location_text: 'El Golf, Barrio El Golf, Las Condes' },
    { location_text: 'Cam. Del Valle Alto, Las Condes, San Carlos De Apoquindo, Las Condes' },
  ]
  assert.equal(comunaMatchRatio(deLasCondes, 'Las Condes'), 1)

  // Lo que devuelve de verdad un slug inválido: anuncios de todo Chile.
  const nacional = [
    { location_text: 'Constancio Vigil 500, Las Condes' },
    { location_text: 'Juan XXIII, Vitacura' },
    { location_text: 'Bludenz 4983, Lo Barnechea, La Dehesa, Lo Barnechea' },
    { location_text: 'Cam. Buin Maipo 1133, Buin, Centro De Buin, Buin' },
  ]
  assert.equal(comunaMatchRatio(nacional, 'Pucón'), 0)

  // El alias resuelve la grafía del portal ("Tiltil" → comuna "Til Til").
  assert.equal(comunaMatchRatio([{ location_text: 'Las Cimas, Tiltil, Alto El Manzano, Tiltil' }], 'Til Til'), 1)

  // Sin nada que medir → null (inerte), NUNCA 0: si un cambio de maquetado
  // dejara de traer location_text, la guarda no debe apagar todas las comunas.
  assert.equal(comunaMatchRatio([], 'Las Condes'), null)
  assert.equal(comunaMatchRatio([{ external_id: 'MLC-1' }], 'Las Condes'), null)
})

test('buildListUrl: TODOS los modificadores en UN segmento, orden _Desde_/_OrderId_/_PriceRange_', () => {
  const base = { comunaSlug: 'las-condes', regionSlug: 'metropolitana', operation: 'sale', propertyType: 'casa' }
  const PI = 'https://www.portalinmobiliario.com'
  // Orden "más recientes" por defecto (estabiliza la paginación, ver buildListUrl).
  assert.equal(
    buildListUrl({ ...base, offset: 0 }),
    `${PI}/venta/casa/propiedades-usadas/las-condes-metropolitana/_OrderId_BEGINS*DESC_NoIndex_True`
  )
  assert.equal(
    buildListUrl({ ...base, offset: 48 }),
    `${PI}/venta/casa/propiedades-usadas/las-condes-metropolitana/_Desde_49_OrderId_BEGINS*DESC_NoIndex_True`
  )
  assert.equal(
    buildListUrl({ ...base, operation: 'rent', offset: 96 }),
    `${PI}/arriendo/casa/propiedades-usadas/las-condes-metropolitana/_Desde_97_OrderId_BEGINS*DESC_NoIndex_True`
  )
  // EL FORMATO CRÍTICO: paginación + orden + precio CONCATENADOS en un único
  // segmento, exactamente como el portal escribe sus propios enlaces de
  // paginación. Con `_PriceRange_` en segmento aparte el portal lo IGNORA desde
  // la página 2 en adelante y devuelve la comuna entera sin filtrar (verificado
  // en real: p10 de la banda 0-15.000 UF traía anuncios de hasta 120.000 UF).
  assert.equal(
    buildListUrl({ ...base, offset: 48, priceRange: { min: 0, max: 15000, unit: 'CLF' } }),
    `${PI}/venta/casa/propiedades-usadas/las-condes-metropolitana/_Desde_49_OrderId_BEGINS*DESC_PriceRange_0CLF-15000CLF_NoIndex_True`
  )
  assert.equal(
    buildListUrl({ ...base, offset: 0, priceRange: { min: 0, max: 15000, unit: 'CLF' } }),
    `${PI}/venta/casa/propiedades-usadas/las-condes-metropolitana/_OrderId_BEGINS*DESC_PriceRange_0CLF-15000CLF_NoIndex_True`
  )
  // Arriendo sigue filtrando en CLP (el arriendo mensual se publica en pesos).
  assert.equal(
    buildListUrl({ ...base, operation: 'rent', offset: 0, priceRange: { min: 0, max: 650000000, unit: 'CLP' } }),
    `${PI}/arriendo/casa/propiedades-usadas/las-condes-metropolitana/_OrderId_BEGINS*DESC_PriceRange_0CLP-650000000CLP_NoIndex_True`
  )
  // Banda ABIERTA [min, ∞): `max: 0` es como el portal escribe "sin tope".
  assert.equal(
    buildListUrl({ ...base, offset: 0, priceRange: { min: 220000, max: 0, unit: 'CLF' } }),
    `${PI}/venta/casa/propiedades-usadas/las-condes-metropolitana/_OrderId_BEGINS*DESC_PriceRange_220000CLF-0CLF_NoIndex_True`
  )
  // Sin nada que añadir, la URL queda desnuda (sin `_NoIndex_True` colgando).
  assert.equal(
    buildListUrl({ ...base, offset: 0, sortRecent: false }),
    `${PI}/venta/casa/propiedades-usadas/las-condes-metropolitana`
  )
})

test('decideContinue: página vacía → completa', () => {
  assert.deepEqual(decideContinue({ page: 3, pageItems: 0, pageCount: 42, maxPages: 60 }), { stop: true, completed: true, reason: null })
})

// El portal reporta `pageCount` INESTABLE dentro de un mismo barrido (visto en
// real: 22 → 21 → 42 en la misma banda). Cortar por ese número perdía anuncios
// en silencio (~70% de cobertura) — ahora se pagina hasta que no haya más.
test('decideContinue: alcanzar pageCount NO corta (el portal lo reporta inestable)', () => {
  const d = decideContinue({ page: 42, pageItems: 48, newInPage: 48, zeroNewStreak: 0, pageCount: 42, maxPages: 60 })
  assert.equal(d.stop, false)
})

test('decideContinue: sigue si hay más páginas', () => {
  assert.deepEqual(decideContinue({ page: 2, pageItems: 48, newInPage: 48, zeroNewStreak: 0, pageCount: 42, maxPages: 60 }), { stop: false, completed: false, reason: null })
})

test('decideContinue: dos páginas seguidas sin nada nuevo → agotado', () => {
  assert.deepEqual(
    decideContinue({ page: 10, pageItems: 48, newInPage: 0, zeroNewStreak: 2, pageCount: null, maxPages: 60 }),
    { stop: true, completed: true, reason: null }
  )
})

test('decideContinue: UNA página repetida no corta (el portal reordena entre peticiones)', () => {
  const d = decideContinue({ page: 10, pageItems: 48, newInPage: 0, zeroNewStreak: 1, pageCount: null, maxPages: 60 })
  assert.equal(d.stop, false)
})

test('decideContinue: tope maxPages por debajo de pageCount → INCOMPLETO', () => {
  const d = decideContinue({ page: 5, pageItems: 48, pageCount: 42, maxPages: 5 })
  assert.equal(d.stop, true)
  assert.equal(d.completed, false)
  assert.match(d.reason, /maxPages/)
})

// ── discoverTarget (integración en memoria) ──────────────────────────────────

const TARGET = {
  id: 'target-1', comuna_id: 'comuna-lc', comuna_name: 'Las Condes',
  region: 'Región Metropolitana de Santiago', operation: 'sale', property_type: 'casa',
}

function listing(id, extra = {}) {
  return { external_id: id, source_url: `https://www.portalinmobiliario.com/${id}`, is_development: false, ...extra }
}

/** Fake client: enruta las 4 consultas de discoverTarget sobre un store en memoria. */
function makeClient({ known = [], activeInComuna = [] }) {
  const knownSet = new Set(known)
  const state = { delistedIds: [], versionLogged: [], stats: null }
  return {
    state,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim()
      if (q.startsWith('SELECT external_id FROM listings_cl')) {
        const ids = params[0]
        return { rows: ids.filter((id) => knownSet.has(id)).map((id) => ({ external_id: id })) }
      }
      if (q.startsWith('SELECT id FROM listings_cl')) {
        // markDelisted: activos de la comuna no vistos este barrido
        const seen = new Set(params[3])
        return { rows: activeInComuna.filter((a) => !seen.has(a.external_id)).map((a) => ({ id: a.id })) }
      }
      if (q.startsWith('UPDATE listings_cl SET is_active = false')) {
        state.delistedIds = params[0]
        return { rowCount: params[0].length }
      }
      if (q.startsWith('INSERT INTO listing_version_log_cl')) {
        state.versionLogged = params[0]
        return { rowCount: params[0].length }
      }
      if (q.startsWith('UPDATE scrape_targets_cl SET')) {
        state.stats = { targetId: params[0], scrapedAt: params[1], completed: params[2], listingCount: params[3], portalTotal: params[4] }
        return { rowCount: 1 }
      }
      throw new Error(`Fake client: consulta no manejada → ${q.slice(0, 80)}`)
    },
  }
}

test('discoverTarget: pagina, filtra proyectos, encola solo lo nuevo, marca bajas y stats', async () => {
  // Página 1: 3 anuncios (uno proyecto que se filtra). MLC-A ya conocido.
  // Página 2: 1 anuncio nuevo, y al ser < page_size el barrido termina completo.
  const pages = {
    0: { listings: [listing('MLC-A'), listing('MLC-B'), listing('MLC-P', { is_development: true })], meta: { total: 3, pageCount: 2 } },
    48: { listings: [listing('MLC-C')], meta: { total: 3, pageCount: 2 } },
  }
  // MLC-A ya está; MLC-Z está activo en la comuna pero NO reaparece → baja.
  const client = makeClient({ known: ['MLC-A'], activeInComuna: [{ id: 'uuid-z', external_id: 'MLC-Z' }, { id: 'uuid-a', external_id: 'MLC-A' }] })

  const enqueued = []
  const res = await discoverTarget(client, TARGET, {
    // Ya no se corta por pageCount: se pagina hasta que el portal deja de
    // devolver resultados (p3 vacía), como en producción.
    fetch: async (url) => ({ ok: true, html: url.includes('_Desde_97') ? 'P3' : url.includes('_Desde_49') ? 'P2' : 'P1' }),
    parseList: (html) => (html === 'P3' ? [] : html === 'P2' ? pages[48].listings : pages[0].listings),
    parseMeta: (html) => (html === 'P2' ? pages[48].meta : pages[0].meta),
    enqueueDetail: async (id, url) => enqueued.push(id),
    sleep: async () => {},
  })

  assert.equal(res.completed, true)
  assert.equal(res.pages, 3) // p1, p2 con datos + p3 vacía que confirma el fin
  assert.equal(res.seen, 3) // A, B, C (el proyecto P se filtró)
  // Encola solo NUEVOS y no-proyecto: B y C (A ya conocido, P filtrado)
  assert.deepEqual(enqueued.sort(), ['MLC-B', 'MLC-C'])
  // Baja: MLC-Z (activo, no reapareció). MLC-A sí apareció → no se da de baja.
  assert.equal(res.delisted, 1)
  assert.deepEqual(client.state.delistedIds, ['uuid-z'])
  assert.deepEqual(client.state.versionLogged, ['uuid-z'])
  // Stats del target
  assert.equal(client.state.stats.completed, true)
  assert.equal(client.state.stats.listingCount, 3)
  assert.equal(client.state.stats.portalTotal, 3)
})

test('discoverTarget: slug de comuna inválido → corta en p1, NI bisecta NI encola, sin bajas', async () => {
  // Reproduce el fallo real de `pucon-araucania`: el portal NO da 404 ante un
  // segmento de comuna que no reconoce — devuelve el listado NACIONAL entero.
  // Sin la guarda, el total nacional (63.020 > resultsLimit) hacía que
  // discoverTarget lo tomara por "comuna que topa la paginación" y lo
  // subdividiera en decenas de bandas de precio, encolando fichas de todo Chile.
  const nacional = [
    listing('MLC-1', { location_text: 'El Golf, Las Condes' }),
    listing('MLC-2', { location_text: 'Juan XXIII, Vitacura' }),
    listing('MLC-3', { location_text: 'Centro De Buin, Buin' }),
  ]
  const client = makeClient({ known: [], activeInComuna: [{ id: 'uuid-z', external_id: 'MLC-Z' }] })

  const enqueued = []
  let peticiones = 0
  const res = await discoverTarget(
    client,
    { ...TARGET, comuna_name: 'Pucón', region: 'Región de la Araucanía' },
    {
      fetch: async () => { peticiones++; return { ok: true, html: 'NACIONAL' } },
      parseList: () => nacional,
      parseMeta: () => ({ total: 63020, pageCount: 1314, resultsLimit: 2000 }),
      enqueueDetail: async (id) => enqueued.push(id),
      sleep: async () => {},
    }
  )

  assert.equal(res.wrong_comuna, true)
  assert.equal(res.completed, false)
  assert.equal(res.exhaustive, false)
  assert.match(res.reason, /slug de comuna inválido/)
  // Lo que de verdad importa: ni una ficha encolada, ni una banda de precio,
  // y UNA sola petición (se corta en la página 1, no pagina 63.000 anuncios).
  assert.deepEqual(enqueued, [])
  assert.equal(res.bands, 0)
  assert.equal(peticiones, 1)
  // Nada de dar bajas con un barrido que jamás vio la comuna.
  assert.equal(res.delisted, 0)
  assert.equal(client.state.delistedIds.length, 0)
  // Y el total NACIONAL no se guarda como el total del portal para esta comuna.
  assert.equal(client.state.stats.completed, false)
  assert.equal(client.state.stats.listingCount, 0)
  assert.equal(client.state.stats.portalTotal, null)
})

test('discoverTarget: fetch que falla en página 1 → incompleto, sin bajas', async () => {
  const client = makeClient({ known: [], activeInComuna: [{ id: 'uuid-z', external_id: 'MLC-Z' }] })
  const res = await discoverTarget(client, TARGET, {
    fetch: async () => ({ ok: false, status: 500, reason: 'HTTP 500' }),
    enqueueDetail: async () => {},
    sleep: async () => {},
  })
  assert.equal(res.completed, false)
  assert.equal(res.pages, 0)
  assert.match(res.reason, /500/)
  assert.equal(res.delisted, 0) // barrido incompleto → NO se marcan bajas
  assert.equal(client.state.delistedIds.length, 0)
  assert.equal(client.state.stats.completed, false) // igual registra last_run_at
})

test('discoverTarget: 404 en página 1 = comuna vacía → completo, sin bajas, éxito', async () => {
  const client = makeClient({ known: [], activeInComuna: [{ id: 'uuid-z', external_id: 'MLC-Z' }] })
  const res = await discoverTarget(client, TARGET, {
    fetch: async () => ({ ok: false, status: 404, reason: 'HTTP 404' }),
    enqueueDetail: async () => {},
    sleep: async () => {},
  })
  assert.equal(res.completed, true) // comuna sin inventario es un barrido vacío LEGÍTIMO
  assert.equal(res.seen, 0)
  assert.equal(res.delisted, 0) // seen=0 → no marca bajas
  assert.match(res.reason, /404/)
  assert.equal(client.state.stats.completed, true) // last_success_at avanza
})

/**
 * Simulador de portal REALISTA: pagina de 48 en 48 y agota cada banda justo en el
 * total que declara (y nunca más allá del tope de 2000 del portal). Hace falta
 * que sea coherente porque sweepBand ya no se fía de que la paginación "acabe
 * bien": contrasta lo visto contra el total declarado (MIN_BAND_COVERAGE) y da
 * la banda por INCOMPLETA si no cuadra. Un fake que declare 800 y sirva 2 por
 * página es justo el barrido truncado que esa comprobación existe para cazar.
 *
 * `totalFor(band, call)` devuelve el total declarado de esa banda; `band` es el
 * token de precio ('0CLF-110000CLF') o 'BASE' sin filtro, y `call` es la
 * n-ésima petición a esa misma URL (para modelar totales que cambian entre el
 * probe y el barrido real).
 */
function makePortal(totalFor) {
  const RESULTS_LIMIT = 2000
  const calls = {}
  const split = (html) => {
    const i = html.lastIndexOf('|CALL|')
    return { url: html.slice(0, i), call: Number(html.slice(i + 6)) }
  }
  const bandOf = (url) => url.match(/_PriceRange_([^_]+)/)?.[1] ?? 'BASE'
  const declared = (html) => { const { url, call } = split(html); return { band: bandOf(url), url, total: totalFor(bandOf(url), call) } }
  return {
    fetch: async (url) => { calls[url] = (calls[url] ?? 0) + 1; return { ok: true, html: `${url}|CALL|${calls[url]}` } },
    parseList: (html) => {
      const { url, band, total } = declared(html)
      const offset = Number(url.match(/_Desde_(\d+)/)?.[1] ?? 1) - 1
      const alcanzable = Math.min(total, RESULTS_LIMIT) // el portal no pagina más allá del tope
      const n = Math.max(0, Math.min(48, alcanzable - offset))
      return Array.from({ length: n }, (_, i) => listing(`MLC-${band}-${offset + i}`))
    },
    parseMeta: (html) => {
      const { total } = declared(html)
      const alcanzable = Math.min(total, RESULTS_LIMIT)
      return { total, pageCount: Math.ceil(alcanzable / 48), resultsLimit: alcanzable }
    },
  }
}

test('discoverTarget: comuna que topa paginación → subdivide por precio y SÍ es exhaustiva', async () => {
  // Comuna grande: total=3479 > tope 2000 → el barrido base topa. Ahora se
  // subdivide por bandas de precio; cada banda cabe → la unión ve el 100% de la
  // comuna → exhaustivo → sí puede dar de baja lo que ya no aparece.
  const client = makeClient({ known: [], activeInComuna: [{ id: 'uuid-vivo', external_id: 'MLC-VIVO' }] })
  // Comuna grande: 3479 sin filtro (topa el tope de 2000) → bisección. Cada
  // banda cabe holgada y se agota entera.
  const portal = makePortal((band) => (band === 'BASE' ? 3479 : 800))
  const res = await discoverTarget(client, TARGET, {
    ...portal,
    enqueueDetail: async () => {},
    sleep: async () => {},
  })
  assert.equal(res.capped, true)
  assert.ok(res.bands >= 1)              // se subdividió por precio
  assert.equal(res.completed, true)
  assert.equal(res.exhaustive, true)     // la unión de bandas cubre todo
  assert.equal(res.delisted, 1)          // MLC-VIVO ya no aparece → baja correcta
  assert.deepEqual(client.state.delistedIds, ['uuid-vivo'])
  assert.match(res.reason, /bandas de precio/)
})

test('discoverTarget: banda que "termina bien" pero vio MENOS de lo declarado → NO es exhaustiva ni da de baja', async () => {
  // La red de seguridad del punto 1: la paginación acaba limpia (página vacía),
  // pero la banda solo sirvió 300 de los 3000 anuncios que declaró. Antes esto
  // se reportaba `completed` y markDelisted daba de baja anuncios vivos que
  // simplemente no se llegaron a ver — el origen del baile de altas/bajas.
  const client = makeClient({ known: [], activeInComuna: [{ id: 'uuid-vivo', external_id: 'MLC-VIVO' }] })
  const res = await discoverTarget(client, TARGET, {
    fetch: async () => ({ ok: true, html: 'P' }),
    // Declara 3000 pero solo entrega 300 (y luego se vacía): cobertura 10%.
    parseList: (() => {
      let served = 0
      return () => {
        if (served >= 300) return []
        const page = Array.from({ length: 48 }, (_, i) => listing(`MLC-${served + i}`))
        served += 48
        return page
      }
    })(),
    parseMeta: () => ({ total: 3000, pageCount: 63, resultsLimit: 3000 }),
    enqueueDetail: async () => {},
    sleep: async () => {},
  })
  assert.equal(res.completed, false)   // la paginación acabó, pero la cobertura no cuadra
  assert.equal(res.exhaustive, false)
  assert.equal(res.delisted, 0)        // ← lo importante: NO da de baja sobre un barrido parcial
  assert.deepEqual(client.state.delistedIds, [])
  assert.match(res.reason, /cobertura del barrido 336\/3000/)
})

test('discoverTarget: un fallo transitorio en UNA banda no invalida un barrido que vio el 98% (regresión de producción)', async () => {
  // Escenario REAL visto en producción tras arreglar la URL: la comuna se barrió
  // al 99,6% (3468/3481) pero `last_success_at` seguía congelado y la detección
  // de bajas apagada, porque bastaba que UNA de las ~95 peticiones fallase para
  // marcar el target incompleto. Ahora manda la cobertura AGREGADA medida.
  //
  // Inventario de 100 anuncios repartidos por precio; el portal solo deja
  // paginar 50 (tope) → el barrido base topa y dispara la bisección. La banda
  // alta pierde su última página por un 500 transitorio: se ven 98 de 100.
  const client = makeClient({ known: [], activeInComuna: [{ id: 'uuid-vivo', external_id: 'MLC-VIVO' }] })
  const RESULTS_LIMIT = 50
  const bandOf = (url) => url.match(/_PriceRange_([^_]+)/)?.[1] ?? 'BASE'
  // Inventario global de 100 anuncios repartidos uniformemente por precio hasta
  // el techo de 220.000 UF. Cada banda sirve su tramo del MISMO inventario (ids
  // compartidos) — es lo que hace que el solapamiento base↔bandas y la cobertura
  // agregada se comporten como en producción.
  const INVENTARIO = 100, TECHO = 220_000
  const idx = (uf) => Math.round((uf / TECHO) * INVENTARIO)
  const sliceOf = (band) => {
    if (band === 'BASE') return [0, INVENTARIO]
    const [min, max] = band.split('-').map((s) => Number(s.replace('CLF', '')))
    return [idx(min), max === 0 ? INVENTARIO : idx(max)] // max 0 = banda abierta [min, ∞)
  }
  const res = await discoverTarget(client, TARGET, {
    fetch: async (url) => {
      // La última página de la banda alta falla con un 500 transitorio.
      if (bandOf(url) === '110000CLF-220000CLF' && url.includes('_Desde_49')) {
        return { ok: false, status: 500, reason: 'HTTP 500' }
      }
      return { ok: true, html: url }
    },
    parseList: (url) => {
      const [from, to] = sliceOf(bandOf(url))
      const offset = Number(url.match(/_Desde_(\d+)/)?.[1] ?? 1) - 1
      const alcanzable = Math.min(to - from, RESULTS_LIMIT)
      const n = Math.max(0, Math.min(48, alcanzable - offset))
      return Array.from({ length: n }, (_, i) => listing(`MLC-${from + offset + i}`))
    },
    parseMeta: (url) => {
      const [from, to] = sliceOf(bandOf(url))
      const total = to - from
      return { total, pageCount: 1, resultsLimit: Math.min(total, RESULTS_LIMIT) }
    },
    enqueueDetail: async () => {},
    sleep: async () => {},
  })

  assert.equal(res.capped, true)
  assert.equal(res.seen, 98)          // se perdieron 2 por el 500 transitorio
  assert.equal(res.exhaustive, true)  // 98/100 = 98% → sigue siendo fiable
  assert.equal(res.completed, true)   // ← last_success_at avanza (antes no lo hacía)
  assert.equal(res.delisted, 1)       // ← y la detección de bajas vuelve a correr
  assert.deepEqual(client.state.delistedIds, ['uuid-vivo'])
})

test('discoverTarget: banda diminuta a la que le falta 1 SÍ es completa (tolerancia absoluta)', async () => {
  // El umbral relativo del 90% no puede castigar a las bandas diminutas: la
  // banda 110.000-220.000 UF de Las Condes tiene exactamente 5 anuncios, y que
  // se venda uno entre el probe y el barrido daría 80% — bloquearía la
  // detección de bajas de toda la comuna por un anuncio.
  const client = makeClient({ known: [], activeInComuna: [{ id: 'uuid-vivo', external_id: 'MLC-VIVO' }] })
  let served = false
  const res = await discoverTarget(client, TARGET, {
    fetch: async () => ({ ok: true, html: 'P' }),
    parseList: () => { if (served) return []; served = true; return [0, 1, 2, 3].map((i) => listing(`MLC-${i}`)) },
    parseMeta: () => ({ total: 5, pageCount: 1, resultsLimit: 5 }), // declara 5, se ven 4
    enqueueDetail: async () => {},
    sleep: async () => {},
  })
  assert.equal(res.completed, true)
  assert.equal(res.exhaustive, true)
  assert.equal(res.delisted, 1) // sí puede dar de baja lo que ya no aparece
})

test('discoverTarget: banda que el probe dio por "chica" pero el barrido real la encuentra topada → se subdivide y corrige (no se pierde en silencio)', async () => {
  // Modela la brecha real vista en producción (Las Condes/Venta quedó en 69%,
  // 2416/3487, pese a que la bisección da cobertura exacta en pruebas con probes
  // que nunca fallan ni cambian de valor): el total de una sub-banda cambia entre
  // el probe y el barrido real (o el probe pudo fallar y devolver null, tratado
  // igual que "cabe" — ver subdividePriceBands). Sin corrección, esos resultados
  // extra se pierden en silencio y el barrido se reporta "completo" sin serlo.
  const client = makeClient({ known: [], activeInComuna: [] })
  // TARGET.operation es 'sale' → discoverTarget bisecta en UF (CLF), techo 220.000.
  const portal = makePortal((band, call) => {
    if (band === 'BASE') return 3479                  // barrido base: topa
    if (band === '0CLF-220000CLF') return 3479        // probe del rango completo
    if (band === '0CLF-110000CLF') {
      // 1ª vez (el probe de subdividePriceBands): "chica", queda como hoja.
      // 2ª vez (el barrido REAL de esa hoja): en realidad topa → hay que corregir.
      return call === 1 ? 800 : 2500
    }
    if (band === '110000CLF-220000CLF') return 50
    if (band === '220000CLF-0CLF') return 0           // banda abierta: vacía
    return 1200                                       // sub-bandas de la corrección: caben
  })
  const res = await discoverTarget(client, TARGET, {
    ...portal,
    enqueueDetail: async () => {},
    sleep: async () => {},
  })

  assert.equal(res.capped, true)      // el barrido base topó → dispara bisección
  assert.equal(res.completed, true)   // la corrección subdivide la hoja "engañosa" y termina completo
  assert.equal(res.exhaustive, true)  // por lo tanto, sí es seguro dar de baja lo que no reaparezca
})

test('subdividePriceBands: bisección recursiva hasta quedar bajo el tope (caso Colina)', async () => {
  // Modela una comuna densa (tipo Colina): la banda alta sigue por encima del
  // tope y hay que partirla otra vez. `probe` devuelve el total por rango.
  const probe = async ({ min, max }) => {
    // Densidad concentrada en la parte baja: [0, mitad) tiene mucho, arriba poco.
    const span = max - min
    if (min === 0 && max === 10_000_000_000) return 5699 // comuna entera
    if (span > 2_000_000_000) return 3000 // bandas anchas todavía topan
    return 1200 // bandas ya estrechas caben
  }
  // Rango EXPLÍCITO: estos totales son de venta en CLP y el techo por defecto
  // en CLP ya es el de arriendo (renta mensual). Se fija aquí para seguir
  // probando el algoritmo, no la constante.
  const bands = await subdividePriceBands(probe, 2000, 0, 10_000_000_000, 'CLP')
  assert.ok(bands.length >= 2, 'debe partir la comuna en varias bandas')
  // Cubren [0, techo] sin huecos ni solapes (contiguas y ordenadas).
  const sorted = [...bands].sort((a, b) => a.min - b.min)
  assert.equal(sorted[0].min, 0)
  assert.equal(sorted[sorted.length - 1].max, 10_000_000_000)
  for (let i = 1; i < sorted.length; i++) assert.equal(sorted[i].min, sorted[i - 1].max)
})

test('subdividePriceBands: comuna bajo el tope → una sola banda, sin bisecar', async () => {
  const probe = async () => 900
  const bands = await subdividePriceBands(probe, 2000, 0, 10_000_000_000, 'CLP')
  assert.equal(bands.length, 1)
  assert.deepEqual(bands[0], { min: 0, max: 10_000_000_000, unit: 'CLP' })
})

test('subdividePriceBands: Las Condes casa/venta REAL en CLP (verificado en vivo 2026-07-24) — cobertura exacta sin huecos', async () => {
  // Totales capturados contra el portal real (venta/casa/las-condes-metropolitana,
  // resultsLimit=2000): confirma que el ALGORITMO de bisección (unidad-agnóstico)
  // alcanza el 100% de la comuna — la suma de las bandas hoja da EXACTO el total
  // sin filtro (3487), sin huecos ni traslapes. discoverTarget ya no bisecta venta
  // en CLP en producción (ver test siguiente, ahora usa CLF/UF), pero el algoritmo
  // en sí debe seguir siendo correcto para cualquier unidad — este test lo fija.
  const REAL_TOTALS = {
    '0-10000000000': 3487, '0-5000000000': 3484, '0-2500000000': 3438,
    '0-1250000000': 3010, '0-625000000': 979, '625000000-1250000000': 2031,
    '625000000-937500000': 1162, '937500000-1250000000': 869,
    '1250000000-2500000000': 428, '2500000000-5000000000': 46, '5000000000-10000000000': 3,
  }
  const probe = async ({ min, max }) => REAL_TOTALS[`${min}-${max}`] ?? null
  const bands = await subdividePriceBands(probe, 2000, 0, 10_000_000_000, 'CLP')

  const sorted = [...bands].sort((a, b) => a.min - b.min)
  assert.equal(sorted[0].min, 0)
  assert.equal(sorted[sorted.length - 1].max, 10_000_000_000)
  for (let i = 1; i < sorted.length; i++) assert.equal(sorted[i].min, sorted[i - 1].max)
  for (const b of sorted) assert.ok((REAL_TOTALS[`${b.min}-${b.max}`] ?? 0) <= 2000, `banda [${b.min},${b.max}] no quedó bajo el tope`)

  const sum = sorted.reduce((s, b) => s + (REAL_TOTALS[`${b.min}-${b.max}`] ?? 0), 0)
  assert.equal(sum, 3487) // === total real sin filtro: cobertura exacta, sin huecos
})

test('subdividePriceBands: Las Condes casa/venta REAL en UF/CLF (verificado en vivo 2026-07-27) — árbol completo, bandas bajo el tope y sin huecos', async () => {
  // Árbol de bisección COMPLETO capturado en vivo contra el portal real
  // (venta/casa/las-condes-metropolitana, techo PRICE_CEILING_CLF=220000,
  // resultsLimit=2000). Cada entrada es un `total` que el portal declaró de
  // verdad para ese rango en UF. Verificado además: `_PriceRange_0CLF-220000CLF`
  // da 3482 = el total EXACTO sin filtro de la comuna, y por encima de 220.000 UF
  // el portal devuelve 404 (no hay inventario) — por eso ese techo basta.
  const REAL_TOTALS_UF = {
    '0-220000': 3482, '0-110000': 3477, '110000-220000': 5,
    '0-55000': 3396, '55000-110000': 81,
    '0-27500': 2725, '27500-55000': 684,
    '0-13750': 692, '13750-27500': 2033,
    '13750-20625': 1201, '20625-27500': 831,
  }
  const probe = async ({ min, max }) => REAL_TOTALS_UF[`${min}-${max}`] ?? null
  const bands = await subdividePriceBands(probe, 2000, 0, 220_000, 'CLF')

  const sorted = [...bands].sort((a, b) => a.min - b.min)
  // Contiguas, cubriendo [0, techo] sin huecos ni solapes, todas en UF.
  assert.equal(sorted[0].min, 0)
  assert.equal(sorted[sorted.length - 1].max, 220_000)
  for (const b of sorted) assert.equal(b.unit, 'CLF')
  for (let i = 1; i < sorted.length; i++) assert.equal(sorted[i].min, sorted[i - 1].max)
  // Toda banda hoja quedó BAJO el tope de paginación (si no, se perderían
  // anuncios: el portal no deja paginar más allá de ~2000 por búsqueda).
  for (const b of sorted) assert.ok(REAL_TOTALS_UF[`${b.min}-${b.max}`] <= 2000, `banda [${b.min},${b.max}] sobre el tope`)
  // Y su suma reconstruye el total de la comuna (3482, con el ruido normal de
  // publicaciones que entran/salen entre peticiones).
  const sum = sorted.reduce((s, b) => s + REAL_TOTALS_UF[`${b.min}-${b.max}`], 0)
  assert.ok(Math.abs(sum - 3482) <= 20, `la suma de bandas (${sum}) debe reconstruir el total 3482`)
})

test('discoverTarget: barrido completo con 0 vistos NO da de baja media comuna', async () => {
  const client = makeClient({ known: [], activeInComuna: [{ id: 'uuid-z', external_id: 'MLC-Z' }] })
  const res = await discoverTarget(client, TARGET, {
    fetch: async () => ({ ok: true, html: 'P1' }),
    parseList: () => [], // página vacía → completo pero sin resultados
    parseMeta: () => ({ total: 0, pageCount: 1 }),
    enqueueDetail: async () => {},
    sleep: async () => {},
  })
  assert.equal(res.completed, true)
  assert.equal(res.seen, 0)
  assert.equal(res.delisted, 0) // guardado: seen.size === 0 → no marca bajas
  assert.equal(client.state.delistedIds.length, 0)
})

test('subdividePriceBands (ARRIENDO/CLP): cubre el mercado real de renta mensual', async () => {
  // Regresión: el techo y el ancho mínimo en CLP estaban puestos como si fueran
  // de VENTA (10.000 millones / 10 millones). Como la bisección arranca en
  // [0, techo] y parte por la mitad, los 8 niveles de profundidad se gastaban
  // bajando desde 10.000M y se rendía en [0 , 39M] — una banda que TODAVÍA
  // contiene el 100% del arriendo (el más caro del portal ronda 20M/mes). El
  // objetivo jamás alcanzaba el 98% de MIN_SWEEP_COVERAGE, así que nunca se
  // marcaba exhaustivo ni daba de baja.
  const N = 4392
  const precios = Array.from({ length: N }, (_, i) => 250_000 + Math.round((i / N) ** 1.6 * 1_800_000))
  const probe = async ({ min, max }) => precios.filter((p) => p >= min && (max === 0 || p < max)).length

  const bands = await subdividePriceBands(probe, 2000)

  // Ninguna banda hoja puede seguir por encima del tope del portal.
  for (const b of bands) {
    assert.ok(await probe(b) <= 2000, `banda [${b.min}, ${b.max}] sigue topando`)
  }
  // Y su unión tiene que cubrir el mercado entero, no un 45%.
  const vistos = new Set()
  for (const b of bands) {
    precios.forEach((p, i) => { if (p >= b.min && (b.max === 0 || p < b.max)) vistos.add(i) })
  }
  assert.equal(vistos.size, N)
  assert.equal(bands.every((b) => b.unit === 'CLP'), true)
})
