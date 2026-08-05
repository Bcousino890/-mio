import test from 'node:test'
import assert from 'node:assert/strict'
import { motivoDeCurl, proxyUrl, evaluarRespuestaPi } from './fetch.mjs'
import { isInfraFailure } from './resilient-fetch.mjs'

// ─────────────────────────────────────────────────────────────────────────────
// Clasificación de fallos de red del scraper. El objetivo de estos tests es que
// el panel de salud pueda decir CUÁL de los tres problemas hay —el proxy no
// responde, el portal bloquea, o la página llega inservible—, porque los tres se
// veían igual (`circuit_open` a secas) y cada uno se arregla de forma distinta.
// ─────────────────────────────────────────────────────────────────────────────

test('un 407 del proxy se identifica como problema del proxy', () => {
  const r = motivoDeCurl({ code: 56 }, 'curl: (56) Received HTTP code 407 from proxy after CONNECT', { usandoProxy: true })
  assert.equal(r.proxyFailed, true)
  assert.match(r.reason, /credenciales/)
})

test('no resolver el host del proxy se identifica como problema del proxy', () => {
  const r = motivoDeCurl({ code: 5 }, "curl: (5) Could not resolve proxy: core-residential.evomi.com", { usandoProxy: true })
  assert.equal(r.proxyFailed, true)
  assert.match(r.reason, /no se resuelve/)
})

test('no poder conectar con el proxy se identifica como problema del proxy', () => {
  const r = motivoDeCurl({ code: 7 }, 'curl: (7) Failed to connect to core-residential.evomi.com port 1000', { usandoProxy: true })
  assert.equal(r.proxyFailed, true)
})

test('un timeout NO se atribuye al proxy: puede ser el portal lento', () => {
  // Importa porque `proxyFailed` es lo que autoriza el rescate por vía directa,
  // que expone la IP de la VPS al portal. Solo se hace cuando es inequívoco que
  // el proxy es el que falla.
  const r = motivoDeCurl({ code: 28 }, 'curl: (28) Operation timed out', { usandoProxy: true })
  assert.equal(r.proxyFailed, false)
  assert.match(r.reason, /timeout/)
})

test('sin proxy en uso, ningún error se atribuye al proxy', () => {
  const r = motivoDeCurl({ code: 7 }, 'curl: (7) Failed to connect', { usandoProxy: false })
  assert.equal(r.proxyFailed, false)
})

test('las credenciales de Evomi se leen del .env en caliente, no del entorno congelado', async (t) => {
  // Mismo fallo que cubre env-vivo.test.mjs, visto desde quien lo sufría: el
  // worker construía la URL del proxy con lo que había en process.env al
  // arrancar el contenedor, así que guardar credenciales nuevas desde la UI no
  // cambiaba nada hasta recrear el worker.
  const previo = { ...process.env }
  t.after(() => { process.env = previo })

  process.env.EVOMI_PROXY_HOST = 'core-residential.evomi.com'
  process.env.EVOMI_PROXY_PORT = '1000'
  process.env.EVOMI_PROXY_USER = 'portales3'
  process.env.EVOMI_PROXY_PASS = 'clave'
  delete process.env.SMARTPROXY_URL
  delete process.env.PROXY_URL

  assert.equal(proxyUrl('portalinmobiliario'), 'http://portales3:clave@core-residential.evomi.com:1000')
  // Otros perfiles (Idealista/España) no tocan Evomi: su ruta queda intacta.
  assert.equal(proxyUrl('idealista'), null)
})

// ── ¿Sirve el 200 que devolvió Portal Inmobiliario? ──────────────────────────

const relleno = 'x'.repeat(600)
// Pantalla antibot de Mercado Libre, tal como llega: HTTP 200, con el marcador
// Nordic (¡también lo lleva!) y sin initialState. Ver web/lib/pi-respuesta.mjs.
const HTML_ANTIBOT = `<html data-assets-prefix="https://http2.mlstatic.com/frontend-assets/suspicious-traffic-frontend/"><head>
<script id="__NORDIC_RENDERING_CTX__">_n.ctx.r={"appProps":{"pageProps":{"siteId":"MLC"}}}</script>
</head><body><a href="/gz/account-verification">verificar</a>${relleno}</body></html>`
const HTML_UTIL = `<html><head><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r={"appProps":{"pageProps":{"initialState":{"results":[]}}}}</script></head><body>${relleno}</body></html>`

test('un 200 con la pantalla antibot deja de contar como página buena', () => {
  // El agujero que tuvo el barrido 5 h parado: el filtro era "¿trae el marcador
  // Nordic?" y la pantalla de bloqueo lo trae, así que entraba como `ok: true`.
  const r = evaluarRespuestaPi({ ok: true, status: 200, html: HTML_ANTIBOT })
  assert.equal(r.ok, false)
  assert.equal(r.bloqueo_antibot, true)
  assert.match(r.reason, /antibot|tráfico sospechoso/i)
})

test('el bloqueo antibot se reintenta: es lo que hace rotar de IP al residencial', () => {
  // Sin esto el barrido pedía la página UNA vez y se rendía. Como fallo de
  // infraestructura, withResilience la vuelve a pedir con backoff y cada intento
  // sale por otra IP del pool — que es la única forma real de destrabarse.
  const r = evaluarRespuestaPi({ ok: true, status: 200, html: HTML_ANTIBOT })
  assert.equal(isInfraFailure(r), true)
})

test('una página con initialState pasa intacta', () => {
  const original = { ok: true, status: 200, html: HTML_UTIL }
  assert.equal(evaluarRespuestaPi(original), original)
})

test('una respuesta ya fallida se devuelve tal cual: un 404 sigue siendo un 404', () => {
  // Importa de verdad: el 404 es el final natural de la paginación de una comuna.
  // Convertirlo en otra cosa rompería la detección de bajas (y lo reintentaría).
  const cuatroCientosCuatro = { ok: false, status: 404, reason: 'HTTP 404' }
  assert.equal(evaluarRespuestaPi(cuatroCientosCuatro), cuatroCientosCuatro)
  assert.equal(isInfraFailure(cuatroCientosCuatro), false)
})

test('la variante ligera sigue detectándose, y no se confunde con el bloqueo', () => {
  const r = evaluarRespuestaPi({ ok: true, status: 200, html: `<html><body>${relleno}</body></html>` })
  assert.equal(r.ok, false)
  assert.equal(r.bloqueo_antibot, false)
  assert.match(r.reason, /ligera/i)
})
