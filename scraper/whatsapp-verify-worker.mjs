#!/usr/bin/env node
/**
 * Worker de verificación de WhatsApp para los teléfonos de DealerNet (CL).
 *
 * Contesta dos preguntas por número, con fecha:
 *   · ¿está HOY en WhatsApp?  (DealerNet da `ind_whatsapp` sin fecha)
 *   · ¿cuál es su foto de perfil ACTUAL?  (DealerNet sirve la que capturó él)
 *
 * Cómo: una sesión de WhatsApp Web multi-dispositivo con Baileys, vinculada a
 * un número propio, que usa el mismo mecanismo que la app al sincronizar la
 * agenda (`onWhatsApp`) más la consulta de foto (`profilePictureUrl`). No
 * envía mensajes; el titular del número consultado no ve nada.
 *
 * Toda la lógica testeable (cola, ritmo, persistencia, interpretación de la
 * foto) vive en lib/whatsapp-verify-cl.mjs con dependencias inyectadas. Este
 * archivo es SOLO el cableado con Baileys y el bucle: es la parte que no se
 * puede probar sin una sesión real.
 *
 * Arranque en frío: sin credenciales guardadas el worker NO verifica nada —
 * publica un QR en `whatsapp_verificador_cl.qr` (y en el log) y espera. La
 * ficha muestra "verificador sin vincular" en vez de dejar todo en "pendiente".
 *
 * ⚠️ Antes de encenderlo, leer docs/WHATSAPP-VERIFICACION.md: esto viola los
 * ToS de WhatsApp y el número verificador puede ser baneado. Usar SIEMPRE un
 * número sacrificable, nunca el corporativo.
 *
 * Variables de entorno:
 *   DATABASE_URL           conexión a Postgres (obligatoria)
 *   WA_VERIFY_AUTH_DIR     dónde persiste la sesión (default ./wa-auth)
 *   WA_VERIFY_POR_MINUTO   checks/min (default 15)
 *   WA_VERIFY_TOPE_DIARIO  checks/día (default 800)
 *   WA_VERIFY_TTL_DIAS     re-verificar un número cada N días (default 30)
 *   WA_VERIFY_INCLUIR_FIJOS  "1" para verificar también los fijos
 */
import pg from 'pg'
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  Browsers,
} from 'baileys'
import {
  RITMO_POR_DEFECTO,
  MAX_FOTO_BYTES,
  selectPendingPhonesCl,
  verifyPhoneCl,
  saveVerificationCl,
  calcularEspera,
  setVerificadorEstadoCl,
  contarCheckDiaCl,
  checksDeHoyCl,
} from './lib/whatsapp-verify-cl.mjs'

const AUTH_DIR = process.env.WA_VERIFY_AUTH_DIR ?? './wa-auth'
const TTL_DIAS = Number(process.env.WA_VERIFY_TTL_DIAS ?? 30)
const INCLUIR_FIJOS = process.env.WA_VERIFY_INCLUIR_FIJOS === '1'
const RITMO = {
  ...RITMO_POR_DEFECTO,
  porMinuto: Number(process.env.WA_VERIFY_POR_MINUTO ?? RITMO_POR_DEFECTO.porMinuto),
  topeDiario: Number(process.env.WA_VERIFY_TOPE_DIARIO ?? RITMO_POR_DEFECTO.topeDiario),
}
// Cuando no queda nada por verificar, dormir en vez de martillar la base.
const ESPERA_SIN_TRABAJO_MS = 5 * 60_000

const log = (...args) => console.log(new Date().toISOString(), '[wa-verify]', ...args)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })

let socket = null
let conectado = false
let detenido = false
/** Se pone en true si Meta banea el número: sin sesión nueva no hay nada que hacer. */
let baneado = false

/**
 * Descarga la foto de perfil. Las URL de WhatsApp caducan en horas, por eso
 * se guardan los BYTES y no el enlace. Se corta la descarga si el
 * Content-Length excede el techo (una foto de perfil son ~10-60 KB).
 */
async function fetchImagen(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const declarado = Number(res.headers.get('content-length') ?? 0)
  if (declarado > MAX_FOTO_BYTES) throw new Error(`foto demasiado grande (${declarado} bytes)`)
  const bytes = Buffer.from(await res.arrayBuffer())
  return { bytes, mime: res.headers.get('content-type') ?? 'image/jpeg' }
}

async function conectar() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  socket = makeWASocket({
    version,
    auth: state,
    // El verificador se presenta como un navegador de escritorio, que es lo
    // que es: un cliente WhatsApp Web multi-dispositivo.
    browser: Browsers.macOS('Desktop'),
    // No nos interesa el historial de chats del número verificador y bajarlo
    // en cada arranque es tráfico y memoria para nada.
    syncFullHistory: false,
    markOnlineOnConnect: false,
  })

  socket.ev.on('creds.update', saveCreds)

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      // El QR se guarda en la base para poder vincularlo desde la UI/API sin
      // entrar al contenedor. Caduca en ~60s: Baileys emite uno nuevo solo.
      log('QR de vinculación emitido — renderízalo con: npx qrcode-terminal "<qr>"')
      await setVerificadorEstadoCl(pool, { estado: 'esperando_qr', qr, ultimo_error: null }).catch(() => {})
    }

    if (connection === 'open') {
      conectado = true
      const numero = socket.user?.id ? `+${String(socket.user.id).split(':')[0]}` : null
      log('sesión conectada', numero ?? '')
      await setVerificadorEstadoCl(pool, {
        estado: 'conectado', numero_e164: numero, qr: null, ultimo_error: null, conectado_at: new Date(),
      }).catch(() => {})
    }

    if (connection === 'close') {
      conectado = false
      // Baileys cierra con errores Boom: el código HTTP viene en output.statusCode
      // (no se importa @hapi/boom para no depender de un paquete transitivo).
      const status = lastDisconnect?.error?.output?.statusCode
      const motivo = lastDisconnect?.error?.message ?? 'desconocido'

      // 401 loggedOut = la sesión fue cerrada desde el teléfono → hay que
      // volver a escanear. 403 forbidden = el número está baneado: reconectar
      // en bucle solo empeora las cosas, se para y se avisa.
      if (status === DisconnectReason.loggedOut) {
        log('sesión cerrada desde el teléfono: hay que volver a vincular')
        await setVerificadorEstadoCl(pool, { estado: 'desvinculado', qr: null, ultimo_error: motivo }).catch(() => {})
        return
      }
      if (status === DisconnectReason.forbidden) {
        baneado = true
        log('⛔ número BANEADO por Meta — el worker se detiene, hay que rotar de número')
        await setVerificadorEstadoCl(pool, { estado: 'baneado', qr: null, ultimo_error: motivo }).catch(() => {})
        return
      }

      log('conexión caída, reconectando:', motivo)
      await setVerificadorEstadoCl(pool, { estado: 'conectando', ultimo_error: motivo }).catch(() => {})
      if (!detenido) {
        await sleep(5_000)
        conectar().catch((e) => log('error reconectando:', e.message))
      }
    }
  })
}

/**
 * Bucle de verificación. Corre en paralelo a la conexión: si la sesión no
 * está lista simplemente espera — nunca verifica "a ciegas".
 */
async function barrer() {
  let hechosHoy = await checksDeHoyCl(pool)

  while (!detenido && !baneado) {
    if (!conectado) {
      await sleep(5_000)
      continue
    }

    const { topeAlcanzado } = calcularEspera(hechosHoy, RITMO)
    if (topeAlcanzado) {
      log(`tope diario alcanzado (${hechosHoy}/${RITMO.topeDiario}) — se retoma mañana`)
      await sleep(ESPERA_SIN_TRABAJO_MS)
      hechosHoy = await checksDeHoyCl(pool) // cambia de día → vuelve a 0
      continue
    }

    const pendientes = await selectPendingPhonesCl(pool, {
      limit: 25, ttlDias: TTL_DIAS, incluirFijos: INCLUIR_FIJOS,
    })
    if (pendientes.length === 0) {
      await sleep(ESPERA_SIN_TRABAJO_MS)
      continue
    }

    for (const fila of pendientes) {
      if (detenido || baneado || !conectado) break

      const { esperaMs, topeAlcanzado: tope } = calcularEspera(hechosHoy, RITMO)
      if (tope) break
      await sleep(esperaMs)
      if (detenido || !conectado) break

      const resultado = await verifyPhoneCl(fila.phone_e164, {
        onWhatsApp: (d) => socket.onWhatsApp(d),
        profilePictureUrl: (jid, tipo) => socket.profilePictureUrl(jid, tipo),
        fetchImagen,
      })
      const { fotoCambiada } = await saveVerificationCl(pool, resultado)
      hechosHoy = await contarCheckDiaCl(pool)

      log(
        fila.phone_e164,
        resultado.estado === 'error'
          ? `error: ${resultado.error}`
          : `whatsapp=${resultado.tiene_whatsapp} foto=${resultado.tiene_foto}${fotoCambiada ? ' (CAMBIÓ)' : ''}`,
        `· ${hechosHoy}/${RITMO.topeDiario} hoy`
      )
    }
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Falta DATABASE_URL')
    process.exit(1)
  }
  log(`arrancando · ritmo ${RITMO.porMinuto}/min · tope ${RITMO.topeDiario}/día · TTL ${TTL_DIAS} días`)

  for (const señal of ['SIGTERM', 'SIGINT']) {
    process.on(señal, () => {
      log('apagando…')
      detenido = true
      socket?.end?.(undefined)
      setTimeout(() => process.exit(0), 1_000)
    })
  }

  await setVerificadorEstadoCl(pool, { estado: 'conectando' }).catch(() => {})
  await conectar()
  await barrer()
}

main().catch(async (e) => {
  log('error fatal:', e?.message ?? e)
  await setVerificadorEstadoCl(pool, { estado: 'error', ultimo_error: String(e?.message ?? e) }).catch(() => {})
  process.exit(1)
})
