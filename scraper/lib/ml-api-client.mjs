// ─────────────────────────────────────────────────────────────────────────────
// Cliente de la API pública de Mercado Libre (sitio MLC = Chile), usada por
// Portalinmobiliario (el vertical inmobiliario de Mercado Libre Chile comparte
// el mismo backend/API que el resto del marketplace).
//
// FUENTE PREFERIDA del LISTADO. Ya no es una nota de futuro: es el camino por
// el que el discovery descubre anuncios cuando hay credenciales puestas (ver
// discovery-fuente-cl.mjs). El HTML de las páginas de búsqueda queda como
// respaldo, porque es justo el que Mercado Libre bloquea con su pantalla de
// "tráfico sospechoso" — un bloqueo por reputación de IP contra el que ni las
// cabeceras ni el proxy hacen nada (ver web/lib/pi-respuesta.mjs).
//
// SUPUESTO YA RESUELTO (era el apéndice de docs/research-portalinmobiliario-chile.md):
// `/sites/MLC/search` y `/items/{id}` NO son accesibles de forma anónima —
// verificado en 2026-08: responden 403 {"message":"forbidden"} sin cabecera
// Authorization. Requieren un token de aplicación, que este cliente pide y
// renueva solo (ver ml-oauth-cl.mjs). Sin credenciales configuradas las
// funciones devuelven { ok: false, reason } —el mismo contrato que fetchHtml—
// en vez de lanzar, para que el pipeline caiga al HTML y siga trabajando.
//
// IMPORTANTE: aunque la API devuelva lat/lng y dirección "limpios", siguen
// siendo el dato declarado por el vendedor — el mismo problema de fiabilidad
// que el HTML. Esta API no resuelve la triangulación de ubicación real; solo
// mejora la calidad de los campos "duros" (precio, superficie, etc.) y, sobre
// todo, hace que el listado se pueda leer.
// ─────────────────────────────────────────────────────────────────────────────
import { execFile } from 'node:child_process'
import { withResilience } from './resilient-fetch.mjs'
import { tokenMl } from './ml-oauth-cl.mjs'

const API_BASE = 'https://api.mercadolibre.com'
const SITE_ID = 'MLC'
export const CATEGORIA_INMUEBLES = 'MLC1459' // Inmuebles (categoría raíz documentada por ML)
const TIMEOUT_S = 20

// Tope duro de la API de búsqueda de sitio: `offset + limit` no puede pasar de
// 1000, y `limit` no puede pasar de 50. No es una cortesía, es un 400 — así que
// una comuna con más de 1000 resultados hay que trocearla por precio, igual que
// ya se hacía con el tope de ~2000 del listado HTML (ver la bisección por bandas
// en discovery-portalinmobiliario-cl.mjs, que es agnóstica de la fuente).
export const TOPE_OFFSET_ML = 1000
export const TOPE_LIMIT_ML = 50

// UA de navegador moderno; igual razonamiento que en fetch.mjs: no hay
// evidencia de anti-bot tipo DataDome contra la API pública de ML.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function curlJson(url, { token = null } = {}) {
  return new Promise((resolve) => {
    const args = [
      '-sS', '--compressed',
      '-m', String(TIMEOUT_S),
      '-A', UA,
      '-H', 'Accept: application/json',
      '-w', '\n__HTTP_STATUS__:%{http_code}',
    ]
    // El token va por cabecera, no como `?access_token=` en la query: así no
    // acaba en los logs de acceso ni en el `reason` de un error que luego se
    // pinta en el panel de salud.
    if (token) args.push('-H', `Authorization: Bearer ${token}`)
    args.push(url)

    execFile('curl', args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        return resolve({ ok: false, status: 0, reason: stderr || err.message })
      }
      const m = stdout.match(/\n__HTTP_STATUS__:(\d+)\s*$/)
      const status = m ? Number(m[1]) : 0
      const body = m ? stdout.slice(0, m.index) : stdout

      if (status === 401 || status === 403) {
        return resolve({ ok: false, status, reason: `HTTP ${status} (token de Mercado Libre rechazado o ausente)` })
      }
      if (status !== 200) {
        return resolve({ ok: false, status, reason: `HTTP ${status}` })
      }
      try {
        resolve({ ok: true, status, data: JSON.parse(body) })
      } catch (e) {
        resolve({ ok: false, status, reason: `JSON inválido: ${e.message}` })
      }
    })
  })
}

/**
 * GET autenticado con renovación de token. Un 401/403 con token en mano
 * significa casi siempre que el token murió antes de tiempo (revocación, cambio
 * de secreto desde la UI): se pide uno FRESCO y se repite UNA vez. Sin este
 * reintento, un token caducado a mitad de barrido dejaba la comuna a medias y el
 * fallo se veía como un bloqueo del portal, que es otro problema y otro arreglo.
 *
 * @param {string} url
 * @param {{ getToken?: typeof tokenMl, http?: typeof curlJson }} [deps]
 */
export async function getJsonMl(url, deps = {}) {
  const { getToken = tokenMl, http = curlJson } = deps

  const primero = await getToken()
  if (!primero.ok) return { ok: false, status: 0, reason: primero.reason }

  const res = await http(url, { token: primero.token })
  if (res.ok || (res.status !== 401 && res.status !== 403)) return res

  const renovado = await getToken({ forzar: true })
  if (!renovado.ok) return { ok: false, status: res.status, reason: renovado.reason }
  return http(url, { token: renovado.token })
}

/**
 * Búsqueda en la categoría inmobiliaria de Mercado Libre Chile.
 *
 * `filtros` se serializa tal cual en la query: son los ids que la API espera
 * (`state`, `city`, `OPERATION`, `PROPERTY_TYPE`, `price`…), no nombres
 * legibles. Traducir "Las Condes" o "Arriendo" a esos ids es trabajo de
 * discovery-fuente-cl.mjs, que lo hace consultando a la propia API y lo cachea
 * — hardcodear ids opacos aquí sería exactamente el tipo de constante que se
 * rompe en silencio cuando ML la cambia.
 *
 * Devuelve { ok: true, status, data } con `data` = respuesta cruda de
 * `/sites/MLC/search`, o { ok: false, status, reason }.
 */
export async function searchListings({ filtros = {}, limit = TOPE_LIMIT_ML, offset = 0, sort = null } = {}, deps = {}) {
  // Sanitiza limit/offset: valores no numéricos o negativos no deben llegar
  // literalmente a la URL (ej. "limit=NaN" o "offset=undefined" si el llamador
  // pasa algo inesperado) — los normalizamos a enteros válidos en vez de lanzar
  // o de mandar basura a la API real. Y se recortan a los topes de la API, que
  // responde 400 si se pasan.
  const nLimit = Number(limit)
  const nOffset = Number(offset)
  const safeLimit = Math.min(Number.isFinite(nLimit) && nLimit > 0 ? Math.floor(nLimit) : TOPE_LIMIT_ML, TOPE_LIMIT_ML)
  const safeOffset = Math.max(Number.isFinite(nOffset) && nOffset >= 0 ? Math.floor(nOffset) : 0, 0)

  const params = new URLSearchParams({
    category: CATEGORIA_INMUEBLES,
    limit: String(safeLimit),
    offset: String(safeOffset),
  })
  for (const [k, v] of Object.entries(filtros)) {
    if (v == null || v === '') continue
    params.set(k, String(v))
  }
  if (sort) params.set('sort', String(sort))

  return getJsonMl(`${API_BASE}/sites/${SITE_ID}/search?${params.toString()}`, deps)
}

/**
 * Detalle estructurado de un ítem por su ID (ej. "MLC-123456789" o
 * "MLC123456789"). La API los quiere SIN guion.
 */
export async function getItem(itemId, deps = {}) {
  if (!itemId) return { ok: false, status: 0, reason: 'itemId vacío' }
  const id = String(itemId).replace(/^MLC-/, 'MLC')
  return getJsonMl(`${API_BASE}/items/${encodeURIComponent(id)}`, deps)
}

/**
 * Estados (regiones) de Chile, con sus ids. Es el primer eslabón para traducir
 * el nombre de una comuna al id opaco que la API pide como filtro `city`.
 */
export async function getEstadosCl(deps = {}) {
  return getJsonMl(`${API_BASE}/countries/CL`, deps)
}

/** Ciudades (comunas) de un estado, con sus ids. Segundo eslabón. */
export async function getCiudadesEstado(estadoId, deps = {}) {
  if (!estadoId) return { ok: false, status: 0, reason: 'estadoId vacío' }
  return getJsonMl(`${API_BASE}/states/${encodeURIComponent(estadoId)}`, deps)
}

// searchListings/getItem + reintentos con backoff + circuit-breaker (H16, ver
// resilient-fetch.mjs). API_BASE fijo como URL para que withResilience derive
// siempre el mismo dominio ('api.mercadolibre.com'), aunque searchListings/
// getItem construyan su propia URL internamente — el fetchImpl cierra sobre
// los parámetros reales y withResilience solo lo usa como "reintentar esto".
//
// El circuito de la API es SUYO y no se mezcla con los de portalinmobiliario.com
// (`#listado`/`#ficha`): son infraestructuras distintas y que una se caiga no
// dice nada de la otra. Es justo lo que permite que, con el listado HTML
// bloqueado, la API siga sirviendo sin heredar su enfriamiento.

export function searchListingsResilient(params, resilienceOptions = {}) {
  return withResilience(() => searchListings(params), API_BASE, resilienceOptions)
}

export function getItemResilient(itemId, resilienceOptions = {}) {
  return withResilience(() => getItem(itemId), API_BASE, resilienceOptions)
}
