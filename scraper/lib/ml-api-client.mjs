// ─────────────────────────────────────────────────────────────────────────────
// Cliente delgado para la API pública de Mercado Libre (sitio MLC = Chile),
// usada por Portalinmobiliario (el vertical inmobiliario de Mercado Libre
// Chile comparte el mismo backend/API que el resto del marketplace).
//
// FUENTE PREFERIDA para campos estructurados (precio, moneda, m², dormitorios,
// baños, fecha de publicación, tipo de vendedor): la API documentada devuelve
// atributos limpios (PRICE, CURRENCY_ID, BEDROOMS, FULL_BATHROOMS,
// COVERED_AREA, CMG_SITE) en vez de tener que parsear HTML/DOM. El parser de
// HTML (`parse-portalinmobiliario.mjs`) debe tratarse como FALLBACK: para
// fotos/descripción/vistas que la API no cubra, o si la API deniega acceso.
//
// SUPUESTO NO CONFIRMADO (ver docs/research-portalinmobiliario-chile.md,
// apéndice): no está verificado si `/sites/MLC/search` y `/items/{id}` siguen
// siendo accesibles sin `access_token` hoy. El sandbox de investigación no
// pudo hacer fetch real contra api.mercadolibre.com. Este cliente asume acceso
// anónimo (sin OAuth) y maneja 401/403 con gracia devolviendo
// { ok: false, status, reason } — el mismo contrato que fetchHtml — en vez de
// lanzar, precisamente para que el primer fetch real en producción sea el
// spike que confirme o refute el supuesto sin tumbar el scraper.
//
// IMPORTANTE: aunque la API devuelva lat/lng y dirección "limpios", siguen
// siendo el dato declarado por el vendedor — el mismo problema de fiabilidad
// que el HTML. Esta API no resuelve la triangulación de ubicación real; solo
// mejora la calidad de los campos "duros" (precio, superficie, etc.).
// ─────────────────────────────────────────────────────────────────────────────
import { execFile } from 'node:child_process'
import { withResilience } from './resilient-fetch.mjs'

const API_BASE = 'https://api.mercadolibre.com'
const SITE_ID = 'MLC'
const CATEGORY_INMOBILIARIA = 'MLC1459' // Inmuebles (categoría raíz documentada por ML)
const TIMEOUT_S = 20

// UA de navegador moderno; igual razonamiento que en fetch.mjs: no hay
// evidencia de anti-bot tipo DataDome contra la API pública de ML.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function curlJson(url) {
  return new Promise((resolve) => {
    const args = [
      '-sS', '--compressed',
      '-m', String(TIMEOUT_S),
      '-A', UA,
      '-H', 'Accept: application/json',
      '-w', '\n__HTTP_STATUS__:%{http_code}',
      url,
    ]
    execFile('curl', args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        return resolve({ ok: false, status: 0, reason: stderr || err.message })
      }
      const m = stdout.match(/\n__HTTP_STATUS__:(\d+)\s*$/)
      const status = m ? Number(m[1]) : 0
      const body = m ? stdout.slice(0, m.index) : stdout

      // Maneja 401/403 con gracia (ver supuesto no confirmado de access_token
      // en la cabecera del archivo) en vez de lanzar.
      if (status === 401 || status === 403) {
        return resolve({ ok: false, status, reason: `HTTP ${status} (¿requiere access_token?)` })
      }
      if (status !== 200) {
        return resolve({ ok: false, status, reason: `HTTP ${status}` })
      }
      try {
        const json = JSON.parse(body)
        resolve({ ok: true, status, data: json })
      } catch (e) {
        resolve({ ok: false, status, reason: `JSON inválido: ${e.message}` })
      }
    })
  })
}

/**
 * Busca anuncios en la categoría inmobiliaria de Mercado Libre Chile.
 * `comuna` se pasa como término de búsqueda libre (`q`) — la API no expone
 * un filtro de comuna estructurado confirmado; a validar en el spike real
 * (podría requerir el atributo CMG_SITE o un filtro de ubicación distinto).
 *
 * Devuelve { ok: true, status, data } con `data` = respuesta cruda de
 * `/sites/MLC/search`, o { ok: false, status, reason }.
 */
export async function searchListings({ comuna, operation = 'rent', limit = 50, offset = 0 } = {}) {
  // Sanitiza limit/offset: valores no numéricos o negativos no deben llegar
  // literalmente a la URL (ej. "limit=NaN" o "offset=undefined" si el
  // llamador pasa algo inesperado) — los normalizamos a enteros válidos en
  // vez de lanzar o de mandar basura a la API real.
  const safeLimit = Number.isFinite(Number(limit)) && Number(limit) >= 0 ? Math.floor(Number(limit)) : 50
  const safeOffset = Number.isFinite(Number(offset)) && Number(offset) >= 0 ? Math.floor(Number(offset)) : 0

  const params = new URLSearchParams({
    category: CATEGORY_INMOBILIARIA,
    limit: String(safeLimit),
    offset: String(safeOffset),
  })
  if (comuna && typeof comuna === 'string' && comuna.trim()) params.set('q', comuna.trim())
  // OPERATION es un atributo documentado (rent/sale); nombre exacto del filtro
  // (`OPERATION` vs algo distinto) sin confirmar contra la API real.
  if (operation) params.set('OPERATION', operation === 'sale' ? 'sale' : 'rent')

  const url = `${API_BASE}/sites/${SITE_ID}/search?${params.toString()}`
  return curlJson(url)
}

/**
 * Obtiene el detalle estructurado de un ítem por su ID (ej. "MLC-123456789"
 * o "MLC123456789", según normalice la API — a confirmar).
 *
 * Devuelve { ok: true, status, data } con `data` = respuesta cruda de
 * `/items/{id}`, o { ok: false, status, reason }.
 */
export async function getItem(itemId) {
  if (!itemId) return { ok: false, status: 0, reason: 'itemId vacío' }
  const url = `${API_BASE}/items/${encodeURIComponent(itemId)}`
  return curlJson(url)
}

// searchListings/getItem + reintentos con backoff + circuit-breaker (H16, ver
// resilient-fetch.mjs). API_BASE fijo como URL para que withResilience derive
// siempre el mismo dominio ('api.mercadolibre.com'), aunque searchListings/
// getItem construyan su propia URL internamente — el fetchImpl cierra sobre
// los parámetros reales y withResilience solo lo usa como "reintentar esto".

export function searchListingsResilient(params, resilienceOptions = {}) {
  return withResilience(() => searchListings(params), API_BASE, resilienceOptions)
}

export function getItemResilient(itemId, resilienceOptions = {}) {
  return withResilience(() => getItem(itemId), API_BASE, resilienceOptions)
}
