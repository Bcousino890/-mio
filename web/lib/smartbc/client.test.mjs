// Tests del cliente de la API de SmartBC (smartbc-client.mjs).
//
// Correr:  node --test scraper/lib/smartbc-client.test.mjs
//
// Blindan las reglas que, si se rompen, o duplican captaciones en el CRM de
// producción del equipo o queman la cuota de 120 peticiones/minuto:
//   · 429/500/503 y los fallos de red se reintentan; 400/401/403/409 NO.
//   · el 429 respeta Retry-After en vez de aplicar su propio backoff.
//   · la Idempotency-Key viaja en toda escritura, y el dry-run en ninguna
//     lectura (una cabecera de más en un GET es ruido, no protección).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SmartbcClient, SmartbcError, parseRetryAfter, backoffMs } from './client.mjs'

function res(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => headers[h] ?? headers[h.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

/**
 * Cliente con respuestas encoladas, reloj simulado y sin esperas reales:
 * dormir avanza el reloj falso, igual que dormir de verdad avanzaría el real.
 */
function makeClient(responses, opts = {}) {
  const calls = []
  const slept = []
  const queue = [...responses]
  let clock = Date.parse('2026-07-31T18:00:00Z')
  const client = new SmartbcClient({
    apiKey: 'sbc_live_test',
    baseUrl: 'https://portal.example',
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      const next = queue.shift()
      if (next instanceof Error) throw next
      return next ?? res(200, { data: {}, request_id: 'req_default' })
    },
    sleep: async (ms) => { slept.push(ms); clock += ms },
    now: () => clock,
    ...opts,
  })
  return { client, calls, slept }
}

test('ping OK devuelve data y request_id', async () => {
  const { client, calls } = makeClient([
    res(200, { data: { ok: true, scopes: ['captaciones:write'] }, request_id: 'req_1' }),
  ])
  const out = await client.ping()
  assert.equal(out.status, 200)
  assert.equal(out.data.ok, true)
  assert.equal(out.requestId, 'req_1')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sbc_live_test')
})

test('un 429 se reintenta y respeta Retry-After por encima del backoff', async () => {
  const { client, slept } = makeClient([
    res(429, { error: { code: 'rate_limited', message: 'demasiadas' } }, { 'Retry-After': '7' }),
    res(200, { data: { ok: true }, request_id: 'req_2' }),
  ])
  const out = await client.request('POST', '/api/v1/captaciones', { body: {} })
  assert.equal(out.status, 200)
  // 7s de la cabecera, no los 2s del backoff exponencial.
  assert.deepEqual(slept, [7000])
})

test('503 y 500 se reintentan con backoff exponencial', async () => {
  const { client, slept } = makeClient([
    res(503, { error: { code: 'service_unavailable', message: 'desplegando' } }),
    res(500, { error: { code: 'internal_error', message: 'boom' } }),
    res(200, { data: { ok: true }, request_id: 'req_3' }),
  ])
  const out = await client.request('POST', '/api/v1/captaciones', { body: {} })
  assert.equal(out.status, 200)
  assert.deepEqual(slept, [2000, 4000])
})

test('un fallo de red se reintenta', async () => {
  const { client, slept } = makeClient([
    new Error('ECONNRESET'),
    res(200, { data: { ok: true }, request_id: 'req_4' }),
  ])
  const out = await client.request('POST', '/api/v1/captaciones', { body: {} })
  assert.equal(out.status, 200)
  assert.deepEqual(slept, [2000])
})

test('400 validation_error NO se reintenta y conserva details + request_id', async () => {
  const { client, calls, slept } = makeClient([
    res(400, {
      error: {
        code: 'validation_error',
        message: 'El cuerpo de la petición no es válido',
        details: [{ field: 'listings.0.price', message: 'Expected number' }],
        request_id: 'req_bad',
      },
    }),
  ])
  await assert.rejects(
    () => client.request('POST', '/api/v1/captaciones', { body: {} }),
    (err) => {
      assert.ok(err instanceof SmartbcError)
      assert.equal(err.status, 400)
      assert.equal(err.code, 'validation_error')
      assert.equal(err.requestId, 'req_bad')
      assert.equal(err.details[0].field, 'listings.0.price')
      assert.equal(err.retryable, false)
      return true
    },
  )
  assert.equal(calls.length, 1, 'no debe reintentar un error del payload')
  assert.deepEqual(slept, [])
})

for (const status of [401, 403, 409, 413]) {
  test(`${status} no se reintenta`, async () => {
    const { client, calls } = makeClient([res(status, { error: { code: 'x', message: 'no' } })])
    await assert.rejects(() => client.request('POST', '/api/v1/captaciones', { body: {} }))
    assert.equal(calls.length, 1)
  })
}

test('se agotan los reintentos y se lanza el último error', async () => {
  const { client, calls } = makeClient([
    res(503, { error: { code: 'service_unavailable', message: 'a' } }),
    res(503, { error: { code: 'service_unavailable', message: 'b' } }),
    res(503, { error: { code: 'service_unavailable', message: 'c' } }),
  ], { retries: 2 })
  await assert.rejects(
    () => client.request('GET', '/api/v1/ping'),
    (err) => err.code === 'service_unavailable' && err.message === 'c',
  )
  assert.equal(calls.length, 3, '1 intento + 2 reintentos')
})

test('la Idempotency-Key viaja en escrituras y nunca en lecturas', async () => {
  const { client, calls } = makeClient([
    res(201, { data: { action: 'created' }, request_id: 'r' }),
    res(200, { data: {}, request_id: 'r' }),
  ])
  await client.upsertCaptacion({ external_id: 'mio-1' }, { idempotencyKey: 'k-1' })
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'k-1')

  await client.request('GET', '/api/v1/ping', { idempotencyKey: 'k-2' })
  assert.equal(calls[1].init.headers['Idempotency-Key'], undefined)
})

test('dry-run pone la cabecera solo en escrituras', async () => {
  const { client, calls } = makeClient([
    res(200, { data: {}, request_id: 'r' }),
    res(200, { data: {}, request_id: 'r' }),
  ], { dryRun: true })
  await client.upsertCaptacion({ external_id: 'mio-1' })
  assert.equal(calls[0].init.headers['X-SmartBC-Dry-Run'], '1')
  await client.ping()
  assert.equal(calls[1].init.headers['X-SmartBC-Dry-Run'], undefined)
})

test('X-Idempotent-Replay se propaga: la escritura no se repitió', async () => {
  const { client } = makeClient([
    res(200, { data: { action: 'created' }, request_id: 'r' }, { 'X-Idempotent-Replay': 'true' }),
  ])
  const out = await client.upsertCaptacion({ external_id: 'mio-1' }, { idempotencyKey: 'k' })
  assert.equal(out.idempotentReplay, true)
})

test('las cabeceras de rate limit se leen de la respuesta', async () => {
  const { client } = makeClient([
    res(200, { data: {}, request_id: 'r' },
      { 'X-RateLimit-Limit': '120', 'X-RateLimit-Remaining': '3', 'X-RateLimit-Reset': '30' }),
  ])
  const out = await client.ping()
  assert.deepEqual(out.rateLimit, { limit: 120, remaining: 3, reset: 30 })
})

test('un lote de más de 100 se rechaza antes de salir a la red', async () => {
  const { client, calls } = makeClient([])
  const items = Array.from({ length: 101 }, (_, i) => ({ external_id: `mio-${i}` }))
  assert.throws(() => client.batch(items), /máximo de SmartBC es 100/)
  assert.equal(calls.length, 0)
})

test('un cuerpo no-JSON en un 5xx es reintentable, no un crash de parseo', async () => {
  const { client } = makeClient([
    res(502, '<html>bad gateway</html>'),
    res(200, { data: { ok: true }, request_id: 'req_ok' }),
  ])
  const out = await client.request('GET', '/api/v1/ping')
  assert.equal(out.status, 200)
})

test('el pacing espera cuando se llena la ventana de peticiones/minuto', async () => {
  const { client, slept } = makeClient(
    Array.from({ length: 3 }, () => res(200, { data: {}, request_id: 'r' })),
    { requestsPerMinute: 2 },
  )
  await client.ping()
  await client.ping()
  assert.deepEqual(slept, [], 'las dos primeras caben en la ventana')
  await client.ping()
  assert.equal(slept.length, 1, 'la tercera espera a que se libere hueco')
  assert.ok(slept[0] > 0)
})

test('parseRetryAfter entiende segundos y fecha HTTP', () => {
  assert.equal(parseRetryAfter('12'), 12_000)
  assert.equal(parseRetryAfter(null), null)
  assert.equal(parseRetryAfter('no-es-nada'), null)
  const now = Date.parse('2026-07-31T18:00:00Z')
  assert.equal(parseRetryAfter('Fri, 31 Jul 2026 18:00:30 GMT', now), 30_000)
  // Una fecha ya pasada no produce una espera negativa.
  assert.equal(parseRetryAfter('Fri, 31 Jul 2026 17:59:00 GMT', now), 0)
})

test('backoffMs es exponencial y tiene tope', () => {
  const opts = { baseBackoffMs: 2000, maxBackoffMs: 10_000 }
  assert.equal(backoffMs(0, opts), 2000)
  assert.equal(backoffMs(1, opts), 4000)
  assert.equal(backoffMs(2, opts), 8000)
  assert.equal(backoffMs(3, opts), 10_000)
})

test('sin apiKey el cliente no se construye', () => {
  assert.throws(() => new SmartbcClient({}), /falta apiKey/)
})
