// Tests del crawl de webs de corredoras (crawl-corredora-web-cl.mjs · Fase 4 / H21).
//
// Correr:  node --test scraper/lib/crawl-corredora-web-cl.test.mjs
//
// Cliente Postgres EN MEMORIA (despacha por substring del SQL) + fetch/upsert
// inyectados — sin red ni base real. Verifica: descubrimiento de fichas desde el
// listado, upsert como agency_web, fijado de corredora_id (lo que engancha el
// Nivel 1.5), backfill del target, rate-limit secuencial y actualización de
// observabilidad. Usa los adaptadores REALES con HTML de fixture.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crawlCorredoraWebTarget } from './crawl-corredora-web-cl.mjs'
import * as ofinet from './crm-adapters/ofinet.mjs'

const LIST_HTML = `<html><body>
  <a href="/propiedad/58124/casa-las-condes">Casa</a>
  <a href="/propiedad/58125/depto-providencia">Depto</a>
  <a href="/nosotros">Nosotros</a>
  <footer>Designed by Ofinet</footer>
</body></html>`

const detailHtml = (code, price) => `<html><head>
  <meta property="og:title" content="Casa en Venta Las Condes" />
  <meta property="og:image" content="https://cdn.b.cl/${code}/1.jpg" />
  </head><body>
  <h1>Casa en Venta Las Condes</h1>
  <div class="price">$ ${price}</div>
  <table class="detalle">
    <tr><td>Dormitorios</td><td>3</td></tr>
    <tr><td>Baños</td><td>2</td></tr>
    <tr><td>Superficie útil</td><td>150 m2</td></tr>
    <tr><td>Comuna</td><td>Las Condes</td></tr>
    <tr><td>Cód.</td><td>${code}</td></tr>
  </table>
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

// fetch inyectado: lista para las list URLs, ficha para las detail URLs.
function makeFetch() {
  const seen = []
  return {
    seen,
    impl: async (url, opts) => {
      seen.push({ url, opts })
      if (/i_listing-4-column\.asp/.test(url)) return { ok: true, html: LIST_HTML }
      const m = url.match(/\/propiedad\/(\d+)/)
      if (m) return { ok: true, html: detailHtml(`OR${m[1]}`, '320.000.000') }
      return { ok: false, reason: 'not_found' }
    },
  }
}

const target = { id: 'tgt-1', domain: 'bpropiedades.cl', corredora_id: null, crm_platform: 'ofinet', interval_hours: 24 }

test('crawl descubre fichas, hace upsert como agency_web y fija corredora_id', async () => {
  const client = makeClient()
  const fetcher = makeFetch()
  const upserts = []
  let mediaEnqueued = 0

  const res = await crawlCorredoraWebTarget(client, target, {
    fetch: fetcher.impl,
    adapter: ofinet,
    upsert: async (_c, parsed) => { upserts.push(parsed); return { listingId: `L-${parsed.seller_reference}` } },
    enqueueMediaSync: async () => { mediaEnqueued++ },
    delayMs: 0,
    sleep: async () => {},
  })

  assert.equal(res.ok, true)
  assert.equal(res.corredora_id, 'cor-1')
  // 2 fichas únicas descubiertas (venta + arriendo apuntan al mismo listado → dedup por Set).
  assert.equal(res.upserted, 2)

  // Cada upsert entró como agency_web con portal web:<domain> y su código interno.
  assert.ok(upserts.every(p => p.source_type === 'agency_web'))
  assert.ok(upserts.every(p => p.portal === 'web:bpropiedades.cl'))
  assert.deepEqual(upserts.map(p => p.seller_reference).sort(), ['OR58124', 'OR58125'])

  // Se fijó corredora_id en cada listing (lo que engancha el Nivel 1.5).
  const corredoraUpdates = client.calls.filter(c => /UPDATE listings_cl SET corredora_id/i.test(c.sql))
  assert.equal(corredoraUpdates.length, 2)
  assert.ok(corredoraUpdates.every(c => c.params[0] === 'cor-1'))

  // Media encolada (las fichas traen fotos).
  assert.equal(mediaEnqueued, 2)

  // Observabilidad: markCrawled con el conteo y sin error.
  const marks = client.calls.filter(c => /UPDATE corredora_web_targets_cl.*last_crawled_at/is.test(c.sql))
  assert.equal(marks.length, 1)
  assert.equal(marks[0].params[1], null) // sin error
})

test('backfill: si el target no trae corredora_id, lo resuelve y lo persiste', async () => {
  const client = makeClient({ corredoraRows: [{ id: 'cor-9' }] })
  const fetcher = makeFetch()
  await crawlCorredoraWebTarget(client, target, {
    fetch: fetcher.impl, adapter: ofinet,
    upsert: async (_c, p) => ({ listingId: `L-${p.seller_reference}` }),
    delayMs: 0, sleep: async () => {},
  })
  const backfill = client.calls.find(c => /UPDATE corredora_web_targets_cl SET corredora_id/i.test(c.sql))
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
  const mark = client.calls.find(c => /last_crawled_at/i.test(c.sql))
  assert.ok(mark, 'igual registra el intento')
  assert.match(mark.params[1], /sin adaptador/) // last_error poblado
})

test('rate-limit: una llamada a sleep por cada request (secuencial)', async () => {
  const client = makeClient()
  const fetcher = makeFetch()
  let sleeps = 0
  await crawlCorredoraWebTarget(client, target, {
    fetch: fetcher.impl, adapter: ofinet,
    upsert: async (_c, p) => ({ listingId: `L-${p.seller_reference}` }),
    delayMs: 1, sleep: async () => { sleeps++ },
  })
  // 2 list fetches + 2 detail fetches = 4 requests → 4 sleeps.
  assert.equal(fetcher.seen.length, 4)
  assert.equal(sleeps, 4)
  // Ninguna request usa proxy (H22).
  assert.ok(fetcher.seen.every(s => s.opts?.useProxy === false))
})

test('listado AJAX (sin enlaces) → 0 fichas, sin error', async () => {
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
