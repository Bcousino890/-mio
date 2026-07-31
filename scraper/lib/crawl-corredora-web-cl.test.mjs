// Tests del crawl de webs de corredoras (crawl-corredora-web-cl.mjs · Fase 4 / H21).
//
// Correr:  node --test scraper/lib/crawl-corredora-web-cl.test.mjs
//
// Cliente Postgres EN MEMORIA (despacha por substring del SQL) + fetch/upsert
// inyectados — sin red ni base real. Verifica: recorrido COMPLETO del listado
// paginado, upsert como agency_web, fijado de corredora_id (lo que engancha el
// Nivel 1.5), backfill del target, cookie jar de sesión, rate-limit secuencial y
// observabilidad. Usa los adaptadores REALES con fixturas del markup real.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crawlCorredoraWebTarget } from './crawl-corredora-web-cl.mjs'
import * as ofinet from './crm-adapters/ofinet.mjs'
import * as convecta from './crm-adapters/convecta.mjs'
import * as konnect from './crm-adapters/konnect.mjs'

// Listado de Ofinet: 9 fichas por página, como el real. La página `n` devuelve
// códigos distintos hasta `pages`, y a partir de ahí una página SIN fichas —
// que es el único criterio de parada válido en Ofinet (su paginador solo enseña
// una ventana de 4 páginas aunque haya 85).
function ofinetListado(page, pages) {
  if (page > pages) return '<html><body><ul class="pagination"></ul></body></html>'
  const cards = Array.from({ length: 9 }, (_, i) =>
    `<a href="property.asp?idPro=${page * 100 + i}"><img src="fotos/${page * 100 + i}a.jpg"></a>`
  ).join('')
  // El paginador miente: enseña como máximo hasta la 4 aunque haya más.
  const links = Array.from({ length: 4 }, (_, i) => `<li><a href="i_listing.asp?Order=ASC&NumPag=${i + 1}#lista">${i + 1}</a></li>`).join('')
  return `<html><body><a href="i_listing.asp?select-status=VE&idPro=0">VENTA</a>${cards}<ul class="pagination">${links}</ul></body></html>`
}

const ofinetFicha = (code) => `<html><head>
  <meta property="og:title" content="CASA EJEMPLO, Lo Barnechea - CyM" />
  </head><body>
  <li><img src="Fotos/${code}a.jpg"><span class="label price">UF 17.500,00</span><span class="label forrent">Venta</span></li>
  <div class="pgl-detail"><ul class="amenities-detail">
    <li><strong>C&oacute;d.:</strong> ${code}</li>
    <li><strong>Tipo:</strong> Casa</li>
    <li><strong>Sup.:</strong> 207,63<sup>m2</sup>/400<sup>m2</sup></li>
    <li><address><i class="icons icon-location"></i> Lo Barnechea, SANTIAGO</address></li>
    <li><i class="icons icon-bedroom"></i> 4 Dormitorios</li>
    <li><i class="icons icon-bathroom"></i> 3 Ba&ntilde;os</li>
  </ul><h2>CASA EJEMPLO</h2></div>
  <footer>Designed by Ofinet</footer></body></html>`

// Cliente en memoria: registra queries y responde según el SQL.
function makeClient({ corredoraRows = [{ id: 'cor-1' }] } = {}) {
  const calls = []
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
      if (/FROM corredoras_cl/i.test(sql)) return { rows: corredoraRows }
      return { rows: [] }
    },
  }
}

/** fetch inyectado sobre un listado de Ofinet de `pages` páginas por operación. */
function makeOfinetFetch({ pages = 2 } = {}) {
  const seen = []
  return {
    seen,
    impl: async (url, opts) => {
      seen.push({ url, opts })
      if (/i_listing\.asp/.test(url)) {
        const page = Number(url.match(/NumPag=(\d+)/)?.[1] ?? 1)
        return { ok: true, html: ofinetListado(page, pages) }
      }
      const m = url.match(/idPro=(\d+)/)
      if (m) return { ok: true, html: ofinetFicha(m[1]) }
      return { ok: false, reason: 'not_found' }
    },
  }
}

const target = {
  id: 'tgt-1', domain: 'cympropiedades.cl', base_url: 'https://www.cympropiedades.cl',
  corredora_id: null, crm_platform: 'ofinet', interval_hours: 24,
}

test('crawl recorre TODAS las páginas del listado, no solo la primera', async () => {
  const client = makeClient()
  const fetcher = makeOfinetFetch({ pages: 3 }) // 3 páginas × 9 fichas por operación
  const upserts = []

  const res = await crawlCorredoraWebTarget(client, target, {
    fetch: fetcher.impl,
    adapter: ofinet,
    upsert: async (_c, parsed) => { upserts.push(parsed); return { listingId: `L-${parsed.seller_reference}` } },
    delayMs: 0,
    sleep: async () => {},
  })

  assert.equal(res.ok, true)
  // 27 fichas únicas. Quedarse en la página 1 —lo que hacía la versión
  // anterior— habría dado 9, que es exactamente cómo cympropiedades.cl parecía
  // tener 36 fichas en vez de 759.
  assert.equal(res.listings, 27)
  assert.equal(res.upserted, 27)
  assert.ok(upserts.every((p) => p.source_type === 'agency_web'))
  assert.ok(upserts.every((p) => p.portal === 'web:cympropiedades.cl'))
})

test('crawl hace upsert como agency_web y fija corredora_id', async () => {
  const client = makeClient()
  const fetcher = makeOfinetFetch({ pages: 1 })
  let mediaEnqueued = 0

  const res = await crawlCorredoraWebTarget(client, target, {
    fetch: fetcher.impl,
    adapter: ofinet,
    upsert: async (_c, p) => ({ listingId: `L-${p.seller_reference}` }),
    enqueueMediaSync: async () => { mediaEnqueued++ },
    delayMs: 0,
    sleep: async () => {},
  })

  assert.equal(res.corredora_id, 'cor-1')
  assert.equal(res.upserted, 9)
  // Se fijó corredora_id en cada listing (lo que engancha el Nivel 1.5).
  const corredoraUpdates = client.calls.filter((c) => /UPDATE listings_cl SET corredora_id/i.test(c.sql))
  assert.equal(corredoraUpdates.length, 9)
  assert.ok(corredoraUpdates.every((c) => c.params[0] === 'cor-1'))
  assert.equal(mediaEnqueued, 9)

  const marks = client.calls.filter((c) => /UPDATE corredora_web_targets_cl.*last_crawled_at/is.test(c.sql))
  assert.equal(marks.length, 1)
  assert.equal(marks[0].params[1], null) // sin error
})

test('la misma ficha en venta y arriendo se descarga una sola vez', async () => {
  // Los dos listados devuelven los MISMOS códigos: sin dedup entre operaciones
  // cada ficha se bajaría y se contaría dos veces.
  const client = makeClient()
  const fetcher = makeOfinetFetch({ pages: 1 })
  const res = await crawlCorredoraWebTarget(client, target, {
    fetch: fetcher.impl, adapter: ofinet,
    upsert: async (_c, p) => ({ listingId: `L-${p.seller_reference}` }),
    delayMs: 0, sleep: async () => {},
  })
  assert.equal(res.listings, 9)
  const detalles = fetcher.seen.filter((s) => /property\.asp/.test(s.url))
  assert.equal(detalles.length, 9)
})

test('Ofinet: las páginas del listado comparten un cookie jar (sesión ASP)', async () => {
  const client = makeClient()
  const fetcher = makeOfinetFetch({ pages: 2 })
  await crawlCorredoraWebTarget(client, target, {
    fetch: fetcher.impl, adapter: ofinet,
    upsert: async (_c, p) => ({ listingId: `L-${p.seller_reference}` }),
    delayMs: 0, sleep: async () => {},
  })
  const listados = fetcher.seen.filter((s) => /i_listing\.asp/.test(s.url))
  // Sin la cookie de la petición que fijó el filtro, la página 2 de Ofinet
  // devuelve cero fichas: todas las páginas de una operación deben ir con el
  // MISMO jar.
  assert.ok(listados.every((s) => typeof s.opts?.cookieJar === 'string' && s.opts.cookieJar.length > 0))
  const venta = listados.slice(0, 3).map((s) => s.opts.cookieJar)
  assert.equal(new Set(venta).size, 1)
})

test('backfill: si el target no trae corredora_id, lo resuelve y lo persiste', async () => {
  const client = makeClient({ corredoraRows: [{ id: 'cor-9' }] })
  const fetcher = makeOfinetFetch({ pages: 1 })
  await crawlCorredoraWebTarget(client, target, {
    fetch: fetcher.impl, adapter: ofinet,
    upsert: async (_c, p) => ({ listingId: `L-${p.seller_reference}` }),
    delayMs: 0, sleep: async () => {},
  })
  const backfill = client.calls.find((c) => /UPDATE corredora_web_targets_cl SET corredora_id/i.test(c.sql))
  assert.ok(backfill, 'debe persistir el corredora_id resuelto en el target')
  assert.equal(backfill.params[0], 'cor-9')
})

test('sin adaptador (crm other): marca error y no revienta', async () => {
  const client = makeClient()
  const res = await crawlCorredoraWebTarget(client, { ...target, crm_platform: 'other' }, {
    adapter: null, delayMs: 0, sleep: async () => {},
  })
  assert.equal(res.ok, false)
  assert.match(res.reason, /sin adaptador/)
  const mark = client.calls.find((c) => /last_crawled_at/i.test(c.sql))
  assert.ok(mark, 'igual registra el intento')
  assert.match(mark.params[1], /sin adaptador/) // last_error poblado
})

test('rate-limit: una llamada a sleep por request, secuencial y sin proxy', async () => {
  const client = makeClient()
  const fetcher = makeOfinetFetch({ pages: 1 })
  let sleeps = 0
  await crawlCorredoraWebTarget(client, target, {
    fetch: fetcher.impl, adapter: ofinet,
    upsert: async (_c, p) => ({ listingId: `L-${p.seller_reference}` }),
    delayMs: 1, sleep: async () => { sleeps++ },
  })
  // Por operación: página 1 (9 fichas) + página 2 (vacía, fin) = 2 listados.
  // 2 operaciones = 4 listados, más 9 fichas únicas = 13 requests.
  assert.equal(fetcher.seen.length, 13)
  assert.equal(sleeps, 13)
  // Ninguna request usa proxy (H22): son sitios pequeños, no hay volumen que esconder.
  assert.ok(fetcher.seen.every((s) => s.opts?.useProxy === false))
  assert.ok(fetcher.seen.every((s) => s.opts?.profile === 'corredora'))
})

test('maxDetails corta el barrido sin dar el target por fallido', async () => {
  const client = makeClient()
  const fetcher = makeOfinetFetch({ pages: 10 })
  const res = await crawlCorredoraWebTarget(client, target, {
    fetch: fetcher.impl, adapter: ofinet,
    upsert: async (_c, p) => ({ listingId: `L-${p.seller_reference}` }),
    delayMs: 0, sleep: async () => {}, maxDetails: 12,
  })
  assert.equal(res.ok, true)
  assert.ok(res.listings <= 12, `esperaba <=12, obtuve ${res.listings}`)
})

test('listado vacío → 0 fichas, sin error', async () => {
  const client = makeClient()
  const res = await crawlCorredoraWebTarget(client, target, {
    fetch: async () => ({ ok: true, html: '<html><body><div id="app">cargando…</div></body></html>' }),
    adapter: ofinet,
    upsert: async () => ({ listingId: 'x' }),
    delayMs: 0, sleep: async () => {},
  })
  assert.equal(res.ok, true)
  assert.equal(res.listings, 0)
  assert.equal(res.upserted, 0)
})

test('Convecta: para al llegar al total declarado y lo registra', async () => {
  // numRegistros = 25 con 20 por página → 2 páginas bastan. Si el crawler
  // ignorara el total seguiría pidiendo páginas hasta el tope.
  const pagina = (page) => JSON.stringify([{
    listing: Array.from({ length: 20 }, (_, i) => `<a href='#' data-id='${page * 1000 + i}'></a>`).join(''),
    paginador: "<li rel='2'></li>",
    numRegistros: '25',
  }])
  const client = makeClient()
  const seen = []
  const res = await crawlCorredoraWebTarget(
    { ...client, calls: client.calls },
    { ...target, domain: 'elbarrio.cl', base_url: 'https://www.elbarrio.cl', crm_platform: 'convecta' },
    {
      fetch: async (url) => {
        seen.push(url)
        if (/publico\.ashx/.test(url)) return { ok: true, html: pagina(Number(url.match(/[?&]pa=(\d+)/)[1])) }
        return { ok: true, html: '<html><body><div class="detail-list"><li><strong>Código:</strong> 1</li></ul></body></html>' }
      },
      adapter: convecta,
      upsert: async (_c, p) => ({ listingId: `L-${p.seller_reference}` }),
      delayMs: 0, sleep: async () => {},
    }
  )
  assert.equal(res.ok, true)
  const listados = seen.filter((u) => /publico\.ashx/.test(u))
  // 2 páginas por operación (venta y arriendo), no más.
  assert.equal(listados.length, 4)
  // El total declarado se guarda para poder comparar contra lo recogido.
  const marks = client.calls.filter((c) => /last_declared_count/i.test(c.sql))
  assert.equal(marks.length, 1)
  assert.equal(marks[0].params[3], 50) // 25 declaradas por cada una de las 2 operaciones
})

test('Konnect: el listado ya trae la ficha, no se descarga cada propiedad', async () => {
  const propiedad = (i) => ({
    externalId: `PP${i}`,
    type: { code: 'house' },
    operation: { code: 'sell' },
    slug: `casa-${i}`,
    price: 10000,
    currencyId: 'UF',
    images: [`https://cdn.pp.com/${i}.jpg`],
    location: { type: 'Point', coordinates: [-70.6, -33.4], name: 'Las Condes' },
    features: { bedrooms: 3, bathrooms: 2, buildSize: 150 },
    office: { name: 'La Dehesa', externalId: 1 },
  })
  const client = makeClient()
  const seen = []
  const res = await crawlCorredoraWebTarget(
    client,
    { ...target, domain: 'ppartnersgroup.com', base_url: 'https://ppartnersgroup.com', crm_platform: 'konnect' },
    {
      fetch: async (url) => {
        seen.push(url)
        return {
          ok: true,
          html: JSON.stringify({
            data: {
              pagination: { totalProperties: 3, maxPages: 1, currentPage: 1 },
              properties: [propiedad(1), propiedad(2), propiedad(3)],
            },
          }),
        }
      },
      adapter: konnect,
      upsert: async (_c, p) => ({ listingId: `L-${p.seller_reference}` }),
      delayMs: 0, sleep: async () => {},
    }
  )
  assert.equal(res.ok, true)
  assert.equal(res.upserted, 3)
  // Solo las 2 llamadas de listado (venta + arriendo). Bajar la ficha HTML de
  // cada propiedad sería una petición extra para obtener MENOS datos.
  assert.equal(seen.length, 2)
  assert.ok(seen.every((u) => /\/api\/properties\/listing\//.test(u)))
})
