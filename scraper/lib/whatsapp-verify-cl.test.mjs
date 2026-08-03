// Tests de whatsapp-verify-cl.mjs (verificación en vivo de WhatsApp).
//
// Correr:  node --test scraper/lib/whatsapp-verify-cl.test.mjs
//
// Lo que se blinda acá no es cosmético:
//  · el ritmo del barrido (calcularEspera) es lo único que separa "enriquecer
//    la base" de "que Meta banee el número verificador";
//  · un número que falla no puede tumbar la pasada ni borrar la última foto
//    buena que ya teníamos;
//  · "sin WhatsApp" tiene que ahorrarse la consulta de foto — cada consulta
//    de más es riesgo de más sobre el mismo número.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  soloDigitos,
  esVerificable,
  verifyPhoneCl,
  calcularEspera,
  RITMO_POR_DEFECTO,
  MAX_FOTO_BYTES,
} from './whatsapp-verify-cl.mjs'

const IMG = Buffer.from('una foto de perfil')

/** Socket falso: registra qué se le preguntó y devuelve lo programado. */
function fakeSock({ exists = true, url = 'https://pps.whatsapp.net/foto.jpg', bytes = IMG, throwOn } = {}) {
  const llamadas = { onWhatsApp: [], profilePictureUrl: [], fetchImagen: [] }
  return {
    llamadas,
    deps: {
      async onWhatsApp(digits) {
        llamadas.onWhatsApp.push(digits)
        if (throwOn === 'onWhatsApp') throw new Error('connection closed')
        return exists ? [{ exists: true, jid: `${digits}@s.whatsapp.net` }] : [{ exists: false }]
      },
      async profilePictureUrl(jid, tipo) {
        llamadas.profilePictureUrl.push([jid, tipo])
        if (throwOn === 'profilePictureUrl') throw new Error('not-authorized')
        return url
      },
      async fetchImagen(u) {
        llamadas.fetchImagen.push(u)
        if (throwOn === 'fetchImagen') throw new Error('404')
        return { bytes, mime: 'image/jpeg' }
      },
    },
  }
}

test('soloDigitos deja el número como lo quiere el protocolo', () => {
  assert.equal(soloDigitos('+56 9 9542 9258'), '56995429258')
  assert.equal(soloDigitos('+56-9-9542-9258'), '56995429258')
  assert.equal(soloDigitos(null), '')
})

test('esVerificable descarta fijos y basura, salvo que se pidan los fijos', () => {
  const celular = { phone_e164: '+56995429258', clasificacion: 'C' }
  const fijo = { phone_e164: '+56223456789', clasificacion: 'F' }

  assert.equal(esVerificable(celular), true)
  assert.equal(esVerificable(fijo), false)
  assert.equal(esVerificable(fijo, { incluirFijos: true }), true)
  // Sin clasificación se intenta igual: DealerNet no siempre la trae.
  assert.equal(esVerificable({ phone_e164: '+56995429258', clasificacion: null }), true)
  assert.equal(esVerificable({ phone_e164: '123' }), false)
})

test('verifyPhoneCl: número con WhatsApp y foto visible', async () => {
  const sock = fakeSock()
  const res = await verifyPhoneCl('+56995429258', sock.deps)

  assert.equal(res.estado, 'ok')
  assert.equal(res.tiene_whatsapp, true)
  assert.equal(res.jid, '56995429258@s.whatsapp.net')
  assert.equal(res.tiene_foto, true)
  assert.equal(res.foto.mime, 'image/jpeg')
  // El sha es lo que después decide si la foto CAMBIÓ.
  assert.match(res.foto.sha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(sock.llamadas.onWhatsApp, ['56995429258'])
})

test('verifyPhoneCl: sin WhatsApp NO se pide la foto (una consulta menos de riesgo)', async () => {
  const sock = fakeSock({ exists: false })
  const res = await verifyPhoneCl('+56995429258', sock.deps)

  assert.equal(res.estado, 'ok')
  assert.equal(res.tiene_whatsapp, false)
  assert.equal(res.tiene_foto, false)
  assert.equal(res.foto, null)
  assert.equal(sock.llamadas.profilePictureUrl.length, 0)
})

test('verifyPhoneCl: foto privada o inexistente NO es un error del check', async () => {
  const sock = fakeSock({ throwOn: 'profilePictureUrl' })
  const res = await verifyPhoneCl('+56995429258', sock.deps)

  // Sigue siendo una verificación válida: sabemos que el número está en
  // WhatsApp, solo que la foto no es visible para nosotros.
  assert.equal(res.estado, 'ok')
  assert.equal(res.tiene_whatsapp, true)
  assert.equal(res.tiene_foto, false)
})

test('verifyPhoneCl: caída de la sesión se reporta como error, sin lanzar', async () => {
  const sock = fakeSock({ throwOn: 'onWhatsApp' })
  const res = await verifyPhoneCl('+56995429258', sock.deps)

  assert.equal(res.estado, 'error')
  assert.match(res.error, /connection closed/)
  // Sin `tiene_whatsapp`: un fallo de red no puede degradar a "no tiene".
  assert.equal(res.tiene_whatsapp, undefined)
})

test('verifyPhoneCl: una foto absurdamente grande se descarta, no se guarda', async () => {
  const sock = fakeSock({ bytes: Buffer.alloc(MAX_FOTO_BYTES + 1) })
  const res = await verifyPhoneCl('+56995429258', sock.deps)

  assert.equal(res.tiene_whatsapp, true)
  assert.equal(res.tiene_foto, false)
})

test('calcularEspera respeta el techo de checks por minuto', () => {
  // Con jitter mínimo (random = 0), la espera nunca baja del piso que impone
  // `porMinuto`: 15/min → 4s entre checks.
  const { esperaMs } = calcularEspera(1, { porMinuto: 15, jitterMs: [0, 0] }, () => 0)
  assert.equal(esperaMs, 4000)
})

test('calcularEspera mete jitter: dos checks seguidos no esperan lo mismo', () => {
  const a = calcularEspera(1, { porMinuto: 60, jitterMs: [1500, 4000] }, () => 0).esperaMs
  const b = calcularEspera(2, { porMinuto: 60, jitterMs: [1500, 4000] }, () => 1).esperaMs
  assert.equal(a, 1500)
  assert.equal(b, 4000)
  assert.notEqual(a, b)
})

test('calcularEspera hace la pausa larga cada N checks', () => {
  const ritmo = { ...RITMO_POR_DEFECTO, pausaCada: 150, pausaMs: 420_000 }
  assert.equal(calcularEspera(150, ritmo, () => 0).esperaMs, 420_000)
  assert.equal(calcularEspera(300, ritmo, () => 0).esperaMs, 420_000)
  assert.notEqual(calcularEspera(151, ritmo, () => 0).esperaMs, 420_000)
  // El check 0 no pausa: si no, cada arranque del worker empezaría durmiendo.
  assert.notEqual(calcularEspera(0, ritmo, () => 0).esperaMs, 420_000)
})

test('calcularEspera corta el día al llegar al tope', () => {
  const ritmo = { ...RITMO_POR_DEFECTO, topeDiario: 800 }
  assert.equal(calcularEspera(799, ritmo, () => 0).topeAlcanzado, false)
  assert.equal(calcularEspera(800, ritmo, () => 0).topeAlcanzado, true)
})

test('el ritmo por defecto se queda MUY por debajo del volumen con ban documentado', () => {
  // whatsapp-web.js#2213: número baneado tras >10.000 checks. El tope diario
  // por defecto tiene que dejar margen de semanas, no de horas.
  assert.ok(RITMO_POR_DEFECTO.topeDiario <= 1000, 'tope diario demasiado alto')
  assert.ok(RITMO_POR_DEFECTO.porMinuto <= 20, 'ritmo por minuto demasiado agresivo')
})
