// ─────────────────────────────────────────────────────────────────────────────
// Tasa UF (Unidad de Fomento) → CLP del día, vía mindicador.cl.
//
// Por qué mindicador.cl y no sii.cl/si3.bcentral.cl:
//   - mindicador.cl es una API pública gratuita construida explícitamente
//     para consumo programático (sin auth, sin rate-limit documentado
//     agresivo, CORS abierto) que republica series oficiales del Banco
//     Central de Chile (BCCh) — entre ellas la UF diaria. A diferencia de
//     sii.cl (ver el banner legal de cadastre-cl.mjs: prohíbe explícitamente
//     scraping automatizado), mindicador.cl SÍ está pensado para que
//     aplicaciones de terceros lo consulten así, tal cual.
//   - El Banco Central (si3.bcentral.cl) es la fuente primaria de la UF,
//     pero su API formal requiere registro/credenciales; mindicador.cl ya
//     republica esa misma serie sin esa friction, y es lo que documentaba
//     el research (docs/research-portalinmobiliario-chile.md, sección de
//     moneda dual UF/CLP) como opción preferida para este caso de uso.
//
// CONTRATO: cierra el TODO de scraper/lib/to-listing.mjs (toAppListingCl) —
// ese archivo NO hace I/O a propósito; es responsabilidad del caller
// (scrape-multi-portal.mjs) resolver `ufRate`/`ufRateDate` ANTES de llamar a
// toAppListingCl y pasarlos como opciones.
//
// MEMOIZACIÓN: una corrida de scraper puede procesar miles de anuncios; no
// tiene sentido pedir la UF del día una vez por anuncio (la UF es la misma
// para todo el día y cambia, como mucho, una vez al día). `getUfRateCl()`
// cachea en memoria de proceso por fecha (UTC, formato YYYY-MM-DD) y
// deduplica peticiones concurrentes en vuelo (si dos llamadas piden la UF de
// "hoy" antes de que la primera responda, la segunda espera la misma
// promesa en vez de disparar un segundo fetch).
// ─────────────────────────────────────────────────────────────────────────────

const MINDICADOR_URL = 'https://mindicador.cl/api/uf'
const TIMEOUT_MS = 8000

// Cache en memoria: fecha (YYYY-MM-DD, tal cual la devuelve mindicador.cl) →
// { rate, date }. Vive mientras viva el proceso Node (una corrida de
// scraper) — no hay necesidad de persistencia entre procesos porque cada
// corrida nueva puede simplemente volver a pedirlo (es gratis y rápido).
const cache = new Map()
// Promesas en vuelo, para no disparar fetches duplicados si llegan varias
// llamadas a getUfRateCl() antes de que la primera resuelva.
const inflight = new Map()

/**
 * Pide la serie UF a mindicador.cl. Nunca lanza: devuelve
 * { ok: true, rate, date } o { ok: false, reason }.
 *
 * `date` es la fecha de la serie tal cual la informa mindicador.cl
 * (normalizada a YYYY-MM-DD), que puede no ser "hoy" si la API todavía no
 * publicó el valor del día (ej. muy temprano en la madrugada) — se persiste
 * la fecha real del dato, no `new Date()` del momento del fetch, porque es
 * justo lo que pide el TODO original en to-listing.mjs.
 */
async function fetchUfRate() {
  try {
    const res = await fetch(MINDICADOR_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` }
    }
    const data = await res.json()
    // Forma documentada de mindicador.cl: { serie: [{ fecha: ISO8601, valor: number }, ...], ... }
    // El primer elemento de `serie` es el valor más reciente.
    const first = Array.isArray(data?.serie) ? data.serie[0] : null
    const rate = Number(first?.valor)
    if (!first || !Number.isFinite(rate) || rate <= 0) {
      return { ok: false, reason: 'Respuesta sin serie.valor numérico válido' }
    }
    // `fecha` viene como ISO8601 con hora (ej. "2024-06-01T03:00:00.000Z");
    // nos interesa solo la fecha calendario.
    const date = String(first.fecha ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    return { ok: true, rate, date }
  } catch (err) {
    // Timeout, red caída, JSON inválido, etc. — degradar con gracia, nunca
    // tumbar el scraper por esto (mismo patrón que geocode-cl.mjs/fetch.mjs).
    return { ok: false, reason: err?.message || String(err) }
  }
}

/**
 * Devuelve la tasa UF→CLP del día (cacheada en memoria de proceso).
 *
 * @param {object} [opts]
 * @param {Date} [opts.now] - inyectable para tests; por defecto `new Date()`.
 * @returns {Promise<{ ok: true, rate: number, date: string } | { ok: false, reason: string }>}
 */
export async function getUfRateCl({ now = new Date() } = {}) {
  const todayKey = now.toISOString().slice(0, 10)

  if (cache.has(todayKey)) {
    return { ok: true, ...cache.get(todayKey) }
  }

  if (inflight.has(todayKey)) {
    return inflight.get(todayKey)
  }

  const promise = (async () => {
    const result = await fetchUfRate()
    if (result.ok) {
      cache.set(todayKey, { rate: result.rate, date: result.date })
      // También cachear bajo la fecha real devuelta por la API, por si no
      // coincide con `todayKey` (ej. la API aún no publicó el valor de hoy
      // y devuelve el de ayer) — así una segunda llamada con esa misma
      // fecha real no dispara otro fetch.
      if (result.date && result.date !== todayKey) {
        cache.set(result.date, { rate: result.rate, date: result.date })
      }
    }
    inflight.delete(todayKey)
    return result
  })()

  inflight.set(todayKey, promise)
  return promise
}

/**
 * Limpia la cache en memoria. Solo para tests; el uso normal del scraper
 * nunca necesita invalidar la UF dentro de una misma corrida (la UF no
 * cambia intra-día).
 */
export function _resetUfRateCacheForTests() {
  cache.clear()
  inflight.clear()
}
