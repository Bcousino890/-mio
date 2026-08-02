import test from 'node:test'
import assert from 'node:assert/strict'
import { motivoDeCurl, proxyUrl } from './fetch.mjs'

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
