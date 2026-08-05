// Tests de la clasificación de respuestas de Portal Inmobiliario.
//
// Correr:  node --test web/lib/pi-respuesta.test.mjs
//
// El caso que da sentido a este módulo es el PRIMERO: la pantalla antibot de
// Mercado Libre lleva el mismo marcador Nordic que una página buena. Mientras la
// única comprobación fue "¿contiene __NORDIC_RENDERING_CTX__?", esa pantalla
// pasaba por página válida en el scraper Y en la sonda del panel, y el barrido se
// quedaba parado detrás de un "respuesta no reconocida" que no señalaba a nada.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clasificarHtmlPi, htmlPiUtilizable, veredictoPi,
  PI_UTIL, PI_ANTIBOT, PI_LIGERA, PI_DESCONOCIDA, PI_VACIA,
} from './pi-respuesta.mjs'

const relleno = (n) => 'x'.repeat(n)

// Recorte FIEL de lo que devuelve el portal a una IP señalada (capturado en real
// el 2026-08-05 contra .../venta/casa/propiedades-usadas/las-condes-metropolitana,
// HTTP 200): prefijo de assets `suspicious-traffic-frontend`, redirección a
// `/gz/account-verification` y —lo importante— el blob Nordic presente, con
// `appProps.pageProps`, pero SIN `initialState`.
const HTML_ANTIBOT = `<!DOCTYPE html><html lang="es-CL" data-assets-prefix="https://http2.mlstatic.com/frontend-assets/suspicious-traffic-frontend/"><head>
<link href="https://http2.mlstatic.com/frontend-assets/suspicious-traffic-frontend/gz-account-verification-index.309e72b8.css" rel="stylesheet"/>
<title id="root-title">Mercado Libre</title>
<noscript><meta http-equiv="refresh" content="0;URL=//www.portalinmobiliario.com/gz/webdevice/config?go=https%3A%2F%2Fwww.portalinmobiliario.com%2Fgz%2Faccount-verification"/></noscript>
<script id="__NORDIC_RENDERING_CTX__">_n.ctx.r={"flags":{"isBot":false},"title":"Mercado Libre","framework":"nordic","appProps":{"pageProps":{"deviceType":"desktop","siteId":"MLC"}}};self.__LOADABLE__=1</script>
</head><body><div class="account-verification-main">${relleno(600)}</div></body></html>`

// Página de listado buena: blob Nordic CON initialState (de donde cuelgan
// results/pagination/melidata_track, lo único que el parser sabe leer).
const HTML_UTIL = `<!DOCTYPE html><html lang="es-CL"><head><title>Casas en venta en Las Condes</title>
<script id="__NORDIC_RENDERING_CTX__">_n.ctx.r={"framework":"nordic","appProps":{"pageProps":{"initialState":{"results":[],"pagination":{"page_count":20,"results_limit":2000},"melidata_track":{"event_data":{"total":3482}}}}}}</script>
</head><body>${relleno(600)}</body></html>`

test('la pantalla antibot NO cuenta como página buena, aunque traiga el blob Nordic', () => {
  // ESTE es el bug: el marcador está, así que el filtro viejo la daba por buena.
  assert.ok(HTML_ANTIBOT.includes('__NORDIC_RENDERING_CTX__'))

  const r = clasificarHtmlPi(HTML_ANTIBOT)
  assert.equal(r.usable, false)
  assert.equal(r.tipo, PI_ANTIBOT)
  assert.match(r.motivo, /antibot|tráfico sospechoso/i)
})

test('una página de listado con initialState sí es utilizable', () => {
  const r = clasificarHtmlPi(HTML_UTIL)
  assert.equal(r.usable, true)
  assert.equal(r.tipo, PI_UTIL)
  assert.equal(r.motivo, null)
  assert.equal(htmlPiUtilizable(HTML_UTIL), true)
})

test('lo útil se decide ANTES que el bloqueo: una página buena no se descarta por nombrar la verificación', () => {
  // Orden de comprobaciones: si algún día un anuncio real menciona
  // "account-verification" (un enlace del pie, una descripción), la página sigue
  // siendo scrapeable y no puede caer en la rama de bloqueo.
  const html = HTML_UTIL.replace('</body>', '<a href="/gz/account-verification">Verificar cuenta</a></body>')
  const r = clasificarHtmlPi(html)
  assert.equal(r.usable, true)
  assert.equal(r.tipo, PI_UTIL)
})

test('la variante ligera (200 sin blob) se distingue del bloqueo', () => {
  const r = clasificarHtmlPi(`<html><body>${relleno(900)}</body></html>`)
  assert.equal(r.usable, false)
  assert.equal(r.tipo, PI_LIGERA)
  assert.match(r.motivo, /ligera/i)
})

test('blob Nordic sin initialState y sin marcas de bloqueo = maquetación desconocida', () => {
  // Se separa del antibot a propósito: uno se arregla rotando IP y el otro
  // arreglando el parser. Mezclarlos manda a perseguir el problema equivocado.
  const html = `<html><head><script id="__NORDIC_RENDERING_CTX__">_n.ctx.r={"appProps":{"pageProps":{"otraCosa":1}}}</script></head><body>${relleno(600)}</body></html>`
  const r = clasificarHtmlPi(html)
  assert.equal(r.usable, false)
  assert.equal(r.tipo, PI_DESCONOCIDA)
})

test('respuesta vacía, corta o no-string: nunca lanza, nunca es utilizable', () => {
  for (const entrada of [null, undefined, '', '<html>corto</html>', 42]) {
    const r = clasificarHtmlPi(entrada)
    assert.equal(r.usable, false)
    assert.equal(r.tipo, PI_VACIA)
  }
})

test('veredictoPi nombra la vía y dice qué hacer', () => {
  assert.match(veredictoPi(PI_UTIL, 'Evomi'), /OK — Evomi/)
  const bloqueo = veredictoPi(PI_ANTIBOT, 'Evomi')
  assert.match(bloqueo, /BLOQUEO ANTIBOT/)
  assert.match(bloqueo, /Evomi/)
  // Que quede claro que el 200 no significa que haya datos.
  assert.match(bloqueo, /200/)
})
