// Tests del token de aplicación de Mercado Libre (ml-oauth-cl.mjs).
//
// Correr:  node --test scraper/lib/ml-oauth-cl.test.mjs
//
// Sin red: el POST se inyecta. Lo que se blinda aquí es la caché (un token por
// cada barrido de 95 peticiones sería absurdo), su caducidad (un token muerto a
// mitad de barrido deja la comuna a medias) y que los errores de credenciales se
// expliquen — "invalid_client" y "no hay credenciales" son dos arreglos
// distintos y desde el panel tienen que distinguirse.

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { tokenMl, credencialesMl, _resetTokenMl } from './ml-oauth-cl.mjs'
import { _resetEnvVivoCache } from './env-vivo.mjs'

function conCredenciales(id = 'app-1', secret = 's3cr3t') {
  process.env.ML_CLIENT_ID = id
  process.env.ML_CLIENT_SECRET = secret
  _resetEnvVivoCache()
}
function sinCredenciales() {
  delete process.env.ML_CLIENT_ID
  delete process.env.ML_CLIENT_SECRET
  _resetEnvVivoCache()
}

/** POST falso que cuenta llamadas y devuelve lo que se le diga. */
function postFalso(respuestas) {
  const llamadas = []
  const cola = [...respuestas]
  const post = async (url, body) => {
    llamadas.push({ url, body })
    return cola.length > 1 ? cola.shift() : cola[0]
  }
  return { post, llamadas }
}

const OK_6H = { status: 200, body: JSON.stringify({ access_token: 'T1', expires_in: 21600 }) }

beforeEach(() => {
  _resetTokenMl()
  sinCredenciales()
})

test('sin ML_CLIENT_ID/SECRET no hay credenciales ni token (y no es una excepción)', async () => {
  assert.equal(credencialesMl(), null)
  const r = await tokenMl({ post: async () => { throw new Error('no debería pedir nada') } })
  assert.equal(r.ok, false)
  assert.match(r.reason, /ML_CLIENT_ID/)
})

test('pide el token una vez y lo reutiliza mientras siga vigente', async () => {
  conCredenciales()
  const { post, llamadas } = postFalso([OK_6H])
  const ahora = () => 1_000_000

  const primero = await tokenMl({ post, ahora })
  assert.deepEqual({ ok: primero.ok, token: primero.token, cacheado: primero.cacheado }, { ok: true, token: 'T1', cacheado: false })

  const segundo = await tokenMl({ post, ahora })
  assert.equal(segundo.token, 'T1')
  assert.equal(segundo.cacheado, true)
  assert.equal(llamadas.length, 1, 'el segundo uso no debe volver a pedir token')
})

test('el cuerpo lleva client_credentials y NO va en los argumentos del proceso', async () => {
  conCredenciales('app-42', 'muy-secreto')
  const { post, llamadas } = postFalso([OK_6H])
  await tokenMl({ post })

  const params = new URLSearchParams(llamadas[0].body)
  assert.equal(params.get('grant_type'), 'client_credentials')
  assert.equal(params.get('client_id'), 'app-42')
  assert.equal(params.get('client_secret'), 'muy-secreto')
  assert.match(llamadas[0].url, /^https:\/\/api\.mercadolibre\.com\/oauth\/token$/)
})

// Se renueva un minuto ANTES de caducar: un token que expira a mitad de un
// barrido largo deja la comuna sin terminar y el fallo se lee como un bloqueo.
test('renueva antes de caducar, con el margen de seguridad', async () => {
  conCredenciales()
  const { post, llamadas } = postFalso([
    { status: 200, body: JSON.stringify({ access_token: 'T1', expires_in: 120 }) },
    { status: 200, body: JSON.stringify({ access_token: 'T2', expires_in: 120 }) },
  ])
  let t = 0
  const ahora = () => t

  assert.equal((await tokenMl({ post, ahora })).token, 'T1')
  // 120s de vida - 60s de margen = vigente hasta t=60s.
  t = 59_000
  assert.equal((await tokenMl({ post, ahora })).token, 'T1')
  t = 61_000
  assert.equal((await tokenMl({ post, ahora })).token, 'T2')
  assert.equal(llamadas.length, 2)
})

test('forzar pide uno nuevo aunque el cacheado siga vigente (401 tras revocar)', async () => {
  conCredenciales()
  const { post, llamadas } = postFalso([
    { status: 200, body: JSON.stringify({ access_token: 'T1', expires_in: 21600 }) },
    { status: 200, body: JSON.stringify({ access_token: 'T2', expires_in: 21600 }) },
  ])
  await tokenMl({ post })
  const r = await tokenMl({ post, forzar: true })
  assert.equal(r.token, 'T2')
  assert.equal(llamadas.length, 2)
})

// Cambiar las credenciales desde la UI reescribe el .env en caliente. El token
// viejo pertenece a OTRA aplicación y ya no vale: seguir usándolo daría 401 en
// bucle sin que nada explicara por qué.
test('cambiar de client_id invalida el token cacheado', async () => {
  conCredenciales('app-vieja')
  const { post, llamadas } = postFalso([
    { status: 200, body: JSON.stringify({ access_token: 'T-vieja', expires_in: 21600 }) },
    { status: 200, body: JSON.stringify({ access_token: 'T-nueva', expires_in: 21600 }) },
  ])
  assert.equal((await tokenMl({ post })).token, 'T-vieja')

  conCredenciales('app-nueva')
  assert.equal((await tokenMl({ post })).token, 'T-nueva')
  assert.equal(llamadas.length, 2)
})

test('un error de credenciales se explica con el mensaje de Mercado Libre', async () => {
  conCredenciales()
  const { post } = postFalso([{ status: 400, body: JSON.stringify({ error: 'invalid_client', message: 'client_secret inválido' }) }])
  const r = await tokenMl({ post })
  assert.equal(r.ok, false)
  assert.match(r.reason, /HTTP 400/)
  assert.match(r.reason, /client_secret inválido/)
})

test('respuesta 200 pero sin access_token no se da por buena', async () => {
  conCredenciales()
  const { post } = postFalso([{ status: 200, body: JSON.stringify({ scope: 'read' }) }])
  const r = await tokenMl({ post })
  assert.equal(r.ok, false)
  assert.match(r.reason, /sin access_token/)
})

test('cuerpo que no es JSON no tumba el worker', async () => {
  conCredenciales()
  const { post } = postFalso([{ status: 200, body: '<html>502 Bad Gateway</html>' }])
  const r = await tokenMl({ post })
  assert.equal(r.ok, false)
  assert.match(r.reason, /JSON inválido/)
})

// Sin `expires_in` se asume vida CORTA, no larga: pedir un token de más cuesta
// una petición; creerse vigente uno muerto cuesta el barrido entero.
test('sin expires_in se asume una vida corta', async () => {
  conCredenciales()
  const { post, llamadas } = postFalso([
    { status: 200, body: JSON.stringify({ access_token: 'T1' }) },
    { status: 200, body: JSON.stringify({ access_token: 'T2' }) },
  ])
  let t = 0
  const ahora = () => t
  await tokenMl({ post, ahora })
  t = 10 * 60_000 // 10 min: por encima de los 600s asumidos menos el margen
  assert.equal((await tokenMl({ post, ahora })).token, 'T2')
  assert.equal(llamadas.length, 2)
})
