import test from 'node:test'
import assert from 'node:assert/strict'
import { withResilience, getCircuitState, isInfraFailure, _resetAllCircuits } from './resilient-fetch.mjs'

const URL_PI = 'https://www.portalinmobiliario.com/venta/casa/propiedades-usadas/las-condes-metropolitana'
// Sin espera real entre reintentos: los tests miden decisiones, no relojes.
const SIN_ESPERA = { baseBackoffMs: 0 }

test.beforeEach(() => _resetAllCircuits())

test('isInfraFailure: separa "el servidor contestó" de "no se pudo hablar con el servidor"', () => {
  assert.equal(isInfraFailure({ ok: true }), false)
  // Respuestas definitivas: el dominio está vivo, esa ES la respuesta.
  assert.equal(isInfraFailure({ ok: false, status: 404 }), false)
  assert.equal(isInfraFailure({ ok: false, status: 410 }), false)
  // Infraestructura: ni respuesta, o el dominio contestando mal.
  assert.equal(isInfraFailure({ ok: false, status: 0, reason: 'proxy caído' }), true)
  assert.equal(isInfraFailure({ ok: false, status: 403 }), true)
  assert.equal(isInfraFailure({ ok: false, status: 429 }), true)
  assert.equal(isInfraFailure({ ok: false, status: 503 }), true)
  // 200 con cuerpo inservible (variante ligera sin blob): merece reintento,
  // porque el residencial rota IP y el siguiente intento puede traer la buena.
  assert.equal(isInfraFailure({ ok: false, status: 200, reason: 'sin blob Nordic' }), true)
})

test('un 404 no se reintenta ni cuenta como caída del dominio', async () => {
  let intentos = 0
  const res = await withResilience(async () => {
    intentos++
    return { ok: false, status: 404, reason: 'HTTP 404' }
  }, URL_PI, SIN_ESPERA)

  assert.equal(res.status, 404)
  // Antes se reintentaba 4 veces con backoff: ~14 s y 3 peticiones de proxy
  // tiradas por cada final de paginación (que SIEMPRE acaba en 404).
  assert.equal(intentos, 1)
  assert.equal(getCircuitState('www.portalinmobiliario.com').failures, 0)
})

test('una ristra de 404 (fin de paginación de varias bandas) NO abre el circuito', async () => {
  // Era la causa raíz de la cascada: 5 finales de banda seguidos cruzaban el
  // umbral del circuit-breaker y a partir de ahí TODO —el resto de comunas y las
  // fichas de detalle— moría con `circuit_open` sin que hubiera ningún problema
  // de red.
  for (let i = 0; i < 8; i++) {
    await withResilience(async () => ({ ok: false, status: 404, reason: 'HTTP 404' }), URL_PI, SIN_ESPERA)
  }
  assert.equal(getCircuitState('www.portalinmobiliario.com').status, 'closed')

  // Y con el circuito cerrado, la siguiente petición buena pasa de verdad.
  const res = await withResilience(async () => ({ ok: true, html: 'x' }), URL_PI, SIN_ESPERA)
  assert.equal(res.ok, true)
})

test('los fallos de infraestructura sí abren el circuito y cortan en seco', async () => {
  for (let i = 0; i < 5; i++) {
    await withResilience(async () => ({ ok: false, status: 0, reason: 'no se pudo conectar con el proxy' }),
      URL_PI, { ...SIN_ESPERA, retries: 1 })
  }
  assert.equal(getCircuitState('www.portalinmobiliario.com').status, 'open')

  let llamado = false
  const res = await withResilience(async () => { llamado = true; return { ok: true, html: 'x' } }, URL_PI, SIN_ESPERA)
  assert.equal(llamado, false)
  assert.match(res.reason, /circuit_open/)
})

test('un 404 cierra un circuito abierto: prueba que el dominio responde', async () => {
  for (let i = 0; i < 5; i++) {
    await withResilience(async () => ({ ok: false, status: 0, reason: 'timeout' }), URL_PI, { ...SIN_ESPERA, retries: 1, cooldownMs: 0 })
  }
  // cooldownMs 0 → el circuito permite ya la llamada de prueba (half-open).
  const res = await withResilience(async () => ({ ok: false, status: 404, reason: 'HTTP 404' }), URL_PI, SIN_ESPERA)
  assert.equal(res.status, 404)
  assert.equal(getCircuitState('www.portalinmobiliario.com').status, 'closed')
})

test('un fallo de infraestructura sí agota los reintentos antes de rendirse', async () => {
  let intentos = 0
  await withResilience(async () => {
    intentos++
    return { ok: false, status: 503, reason: 'HTTP 503' }
  }, URL_PI, { ...SIN_ESPERA, retries: 4 })
  assert.equal(intentos, 4)
})
