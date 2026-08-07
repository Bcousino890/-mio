// ─────────────────────────────────────────────────────────────────────────────
// Token de aplicación de Mercado Libre (grant_type=client_credentials).
//
// POR QUÉ EXISTE. El barrido del LISTADO de Portal Inmobiliario se hacía
// bajando el HTML de las páginas de búsqueda, y Mercado Libre lleva meses
// respondiéndole a esas páginas con su pantalla de "tráfico sospechoso": HTTP
// 200, cero anuncios, y el bloqueo decidido por la reputación de la IP de
// salida. No hay ajuste de cabeceras, de proxy ni de parser que lo arregle —
// está comprobado y documentado en web/lib/pi-respuesta.mjs. Cambiar de pool o
// de geo solo mueve el problema unos días.
//
// La salida NO es esconderse mejor, es dejar de pedir por la puerta que está
// cerrada: Mercado Libre publica una API de búsqueda documentada
// (api.mercadolibre.com) para exactamente este caso de uso. Es la MISMA
// información del listado, servida por una vía pensada para clientes
// automáticos, autenticada con una aplicación propia en vez de filtrada por
// reputación de IP. Ahí no hay antibot que esquivar porque no hay nada que
// esquivar.
//
// Requisito: registrar una aplicación (gratis, autoservicio) en
// https://developers.mercadolibre.cl → "Mis aplicaciones" → "Crear aplicación",
// y poner su client_id/client_secret en el `.env`:
//
//     ML_CLIENT_ID=...
//     ML_CLIENT_SECRET=...
//
// Sin esas dos variables este módulo devuelve `null` y todo el pipeline sigue
// funcionando exactamente como hasta ahora (fuente HTML). No rompe nada al
// desplegar: solo se activa cuando hay credenciales.
//
// Se leen con envVivo (no process.env) por lo mismo que el proxy: la UI de
// Configuración reescribe el `.env` en caliente y el worker lo tenía congelado
// desde el arranque del contenedor (ver env-vivo.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import { execFile } from 'node:child_process'
import { envVivo } from './env-vivo.mjs'

const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token'
const TIMEOUT_S = 20
// Se renueva un minuto ANTES de que caduque: un token que expira a mitad de un
// barrido de 95 peticiones deja media comuna sin leer, y renovar de más cuesta
// una petición cada seis horas.
const MARGEN_CADUCIDAD_MS = 60_000

/**
 * Credenciales de la aplicación de Mercado Libre, o `null` si no están puestas.
 * `null` NO es un error: significa "esta instalación aún no tiene la API
 * configurada" y el discovery se queda con la fuente HTML de siempre.
 */
export function credencialesMl() {
  const clientId = envVivo('ML_CLIENT_ID')
  const clientSecret = envVivo('ML_CLIENT_SECRET')
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

/**
 * POST application/x-www-form-urlencoded con el cuerpo por STDIN.
 *
 * El cuerpo lleva el client_secret, y los argumentos de un proceso son
 * legibles por cualquiera que pueda mirar /proc en la misma máquina. Con
 * `-d @-` el secreto viaja por la entrada estándar y nunca aparece en la lista
 * de procesos ni en un `ps` accidental durante un diagnóstico.
 */
function postForm(url, body) {
  return new Promise((resolve) => {
    const args = [
      '-sS', '-m', String(TIMEOUT_S),
      '-X', 'POST',
      '-H', 'Content-Type: application/x-www-form-urlencoded',
      '-H', 'Accept: application/json',
      '-w', '\n__HTTP_STATUS__:%{http_code}',
      '-d', '@-',
      url,
    ]
    const child = execFile('curl', args, { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) return resolve({ status: 0, body: String(stderr || err.message) })
      const m = stdout.match(/\n__HTTP_STATUS__:(\d+)\s*$/)
      resolve({
        status: m ? Number(m[1]) : 0,
        body: m ? stdout.slice(0, m.index) : stdout,
      })
    })
    child.stdin.end(body)
  })
}

// { token, expiraEnMs, clientId } — el clientId forma parte de la caché a
// propósito: si se cambian las credenciales en caliente desde la UI, el token
// viejo deja de valer y hay que pedir uno nuevo en vez de seguir usándolo.
let cache = null

/** Solo para tests: olvida el token cacheado. */
export function _resetTokenMl() {
  cache = null
}

/**
 * Token de aplicación vigente. Devuelve { ok: true, token } o
 * { ok: false, reason } — nunca lanza, mismo contrato que el resto de clientes
 * de red del scraper.
 *
 * @param {{ forzar?: boolean, post?: typeof postForm, ahora?: () => number }} [opts]
 *   `forzar` pide uno nuevo aunque el cacheado no haya caducado: es lo que se
 *   usa cuando la API responde 401 pese a tener token (revocación, cambio de
 *   secreto), para no quedarse en bucle con uno muerto.
 */
export async function tokenMl({ forzar = false, post = postForm, ahora = Date.now } = {}) {
  const cred = credencialesMl()
  if (!cred) return { ok: false, reason: 'sin ML_CLIENT_ID / ML_CLIENT_SECRET' }

  if (!forzar && cache && cache.clientId === cred.clientId && ahora() < cache.expiraEnMs) {
    return { ok: true, token: cache.token, cacheado: true }
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cred.clientId,
    client_secret: cred.clientSecret,
  }).toString()

  const { status, body: texto } = await post(TOKEN_URL, body)
  if (status !== 200) {
    // El cuerpo de error de ML trae `message`/`error` legibles ("invalid_client",
    // "invalid_grant"): se propagan tal cual porque son la diferencia entre
    // "credenciales mal copiadas" y "la aplicación no tiene permisos".
    let detalle = texto?.slice(0, 200) ?? ''
    try {
      const j = JSON.parse(texto)
      detalle = j.message ?? j.error_description ?? j.error ?? detalle
    } catch { /* cuerpo no-JSON: se deja el texto crudo recortado */ }
    return { ok: false, status, reason: `token de Mercado Libre: HTTP ${status} (${detalle})` }
  }

  let json
  try {
    json = JSON.parse(texto)
  } catch (e) {
    return { ok: false, status, reason: `token de Mercado Libre: JSON inválido (${e.message})` }
  }
  if (!json?.access_token) {
    return { ok: false, status, reason: 'token de Mercado Libre: respuesta sin access_token' }
  }

  // `expires_in` viene en segundos (ML devuelve 21600 = 6 h). Si faltara, se
  // asume una vida corta en vez de una larga: reintentar de más es barato,
  // creerse vigente un token muerto para el barrido entero no.
  const vidaMs = (Number(json.expires_in) > 0 ? Number(json.expires_in) : 600) * 1000
  cache = {
    token: json.access_token,
    expiraEnMs: ahora() + Math.max(vidaMs - MARGEN_CADUCIDAD_MS, 0),
    clientId: cred.clientId,
  }
  return { ok: true, token: cache.token, cacheado: false }
}
