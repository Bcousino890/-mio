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
})

test('buildListUrl: ordena por más recientes y pagina con _Desde_N', () => {
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
  // Con banda de precio, el orden NO se aplica aunque sortRecent sea true:
  // BUG VERIFICADO contra el portal real — combinar _PriceRange_ con
  // _OrderId_BEGINS*DESC hace que el portal devuelva un `total` MENOR y falso
  // (banda 0-650M: 1105 sin orden vs 971 con orden, mismo rango exacto). Era la
  // causa de que la cobertura de comunas grandes cayera de ~70% a ~40%: la
  // bisección por precio creía que había menos anuncios de los reales.
  assert.equal(
    buildListUrl({ ...base, offset: 48, priceRange: { min: 0, max: 650000000, unit: 'CLP' } }),
    `${PI}/venta/casa/propiedades-usadas/las-condes-metropolitana/_PriceRange_0CLP-650000000CLP/_Desde_49_NoIndex_True`
  )
  // Venta filtra en UF (CLF): confirmado en vivo contra Las Condes — el propio
  // portal ofrece bandas nativas en UF y su suma da el total exacto sin
  // bisección extra (ver PRICE_CEILING_CLF en discovery-portalinmobiliario-cl.mjs).
  assert.equal(
    buildListUrl({ ...base, offset: 0, priceRange: { min: 0, max: 15000, unit: 'CLF' } }),
    `${PI}/venta/casa/propiedades-usadas/las-condes-metropolitana/_PriceRange_0CLF-15000CLF`
  )
  // Sin priceRange, sortRecent:false mantiene el formato clásico sin orden.
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

test('discoverTarget: comuna que topa paginación → subdivide por precio y SÍ es exhaustiva', async () => {
  // Comuna grande: total=3479 > tope 2000 → el barrido base topa. Ahora se
  // subdivide por bandas de precio; cada banda cabe → la unión ve el 100% de la
  // comuna → exhaustivo → sí puede dar de baja lo que ya no aparece.
  const client = makeClient({ known: [], activeInComuna: [{ id: 'uuid-vivo', external_id: 'MLC-VIVO' }] })
  let page = 0, metaCall = 0
  const res = await discoverTarget(client, TARGET, {
    fetch: async () => ({ ok: true, html: 'P' }),
    parseList: () => { page++; return [listing(`MLC-${page}-a`), listing(`MLC-${page}-b`)] },
    parseMeta: () => {
      metaCall++
      // Primera llamada (barrido base, página 1): la comuna topa.
      if (metaCall === 1) return { total: 3479, pageCount: 1, resultsLimit: 2000 }
      // Probes y barridos de banda: cada banda cabe bajo el tope y termina.
      return { total: 800, pageCount: 1, resultsLimit: 2000 }
    },
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

test('discoverTarget: banda que el probe dio por "chica" pero el barrido real la encuentra topada → se subdivide y corrige (no se pierde en silencio)', async () => {
  // Modela la brecha real vista en producción (Las Condes/Venta quedó en 69%,
  // 2416/3487, pese a que la bisección da cobertura exacta en pruebas con probes
  // que nunca fallan ni cambian de valor): el total de una sub-banda cambia entre
  // el probe y el barrido real (o el probe pudo fallar y devolver null, tratado
  // igual que "cabe" — ver subdividePriceBands). Sin corrección, esos resultados
  // extra se pierden en silencio y el barrido se reporta "completo" sin serlo.
  const client = makeClient({ known: [], activeInComuna: [] })
  const RESULTS_LIMIT = 2000
  const calls = {}

  const fetchFn = async (url) => {
    calls[url] = (calls[url] || 0) + 1
    return { ok: true, html: `${url}|CALL|${calls[url]}` }
  }
  // TARGET.operation es 'sale' → discoverTarget bisecta en UF (CLF), no CLP.
  const parseMetaFn = (html) => {
    const sep = html.lastIndexOf('|CALL|')
    const url = html.slice(0, sep)
    const call = Number(html.slice(sep + 6))
    if (!url.includes('_PriceRange_')) return { total: 3479, pageCount: 1, resultsLimit: RESULTS_LIMIT } // barrido base: topa
    if (url.includes('_PriceRange_0CLF-300000CLF')) return { total: 3479, pageCount: 1, resultsLimit: RESULTS_LIMIT } // probe rango completo
    if (url.includes('_PriceRange_0CLF-150000CLF')) {
      // 1ª vez (el probe de subdividePriceBands): "chica", queda como hoja.
      // 2ª vez (el barrido REAL de esa hoja): en realidad topa.
      return call === 1 ? { total: 800, pageCount: 1, resultsLimit: RESULTS_LIMIT } : { total: 2500, pageCount: 1, resultsLimit: RESULTS_LIMIT }
    }
    if (url.includes('_PriceRange_150000CLF-300000CLF')) return { total: 50, pageCount: 1, resultsLimit: RESULTS_LIMIT }
    // Sub-bandas nacidas de la corrección de [0, 150.000]: caben.
    return { total: 1200, pageCount: 1, resultsLimit: RESULTS_LIMIT }
  }
  let n = 0
  const res = await discoverTarget(client, TARGET, {
    fetch: fetchFn,
    parseMeta: parseMetaFn,
    parseList: () => { n++; return [listing(`MLC-${n}-a`), listing(`MLC-${n}-b`)] },
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
  const bands = await subdividePriceBands(probe, 2000)
  assert.ok(bands.length >= 2, 'debe partir la comuna en varias bandas')
  // Cubren [0, techo] sin huecos ni solapes (contiguas y ordenadas).
  const sorted = [...bands].sort((a, b) => a.min - b.min)
  assert.equal(sorted[0].min, 0)
  assert.equal(sorted[sorted.length - 1].max, 10_000_000_000)
  for (let i = 1; i < sorted.length; i++) assert.equal(sorted[i].min, sorted[i - 1].max)
})

test('subdividePriceBands: comuna bajo el tope → una sola banda, sin bisecar', async () => {
  const probe = async () => 900
  const bands = await subdividePriceBands(probe, 2000)
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
  const bands = await subdividePriceBands(probe, 2000)

  const sorted = [...bands].sort((a, b) => a.min - b.min)
  assert.equal(sorted[0].min, 0)
  assert.equal(sorted[sorted.length - 1].max, 10_000_000_000)
  for (let i = 1; i < sorted.length; i++) assert.equal(sorted[i].min, sorted[i - 1].max)
  for (const b of sorted) assert.ok((REAL_TOTALS[`${b.min}-${b.max}`] ?? 0) <= 2000, `banda [${b.min},${b.max}] no quedó bajo el tope`)

  const sum = sorted.reduce((s, b) => s + (REAL_TOTALS[`${b.min}-${b.max}`] ?? 0), 0)
  assert.equal(sum, 3487) // === total real sin filtro: cobertura exacta, sin huecos
})

test('subdividePriceBands: Las Condes casa/venta REAL en UF/CLF (verificado en vivo 2026-07-27) — venta filtra en UF', async () => {
  // Totales capturados en vivo contra el portal real, en UF (venta/casa/
  // las-condes-metropolitana, techo PRICE_CEILING_CLF=300000, resultsLimit=2000).
  // Confirma en datos reales los primeros niveles de bisección que el algoritmo
  // efectivamente recorre con este techo: la banda sigue topada por debajo de
  // 75.000 UF porque casi todo el inventario de Las Condes está ahí (las bandas
  // NATIVAS del propio portal —0-15000, 15000-24000, 24000-∞ UF— dan
  // 941+1316+1225=3482, el total exacto, evidencia de que UF es la unidad
  // correcta para venta). Por debajo de 75.000 UF no se sondeó punto a punto
  // contra el portal — se aproxima proporcionalmente al ancho solo para que la
  // bisección del test termine determinísticamente.
  const REAL_TOTALS_UF = {
    '0-300000': 3482, '0-150000': 3480, '150000-300000': 2,
    '0-75000': 3457, '75000-150000': 23,
  }
  const probe = async ({ min, max }) => {
    const key = `${min}-${max}`
    if (key in REAL_TOTALS_UF) return REAL_TOTALS_UF[key]
    return Math.round(((max - min) / 75_000) * 3457)
  }
  const bands = await subdividePriceBands(probe, 2000, 0, 300_000, 'CLF')

  const sorted = [...bands].sort((a, b) => a.min - b.min)
  assert.equal(sorted[0].min, 0)
  assert.equal(sorted[sorted.length - 1].max, 300_000)
  for (const b of sorted) assert.equal(b.unit, 'CLF')
  for (let i = 1; i < sorted.length; i++) assert.equal(sorted[i].min, sorted[i - 1].max)
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
