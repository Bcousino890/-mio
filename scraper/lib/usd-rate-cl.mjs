// ─────────────────────────────────────────────────────────────────────────────
// Tasa dólar observado (USD) → CLP del día, vía mindicador.cl.
//
// Misma fuente y mismo contrato que uf-rate-cl.mjs: mindicador.cl republica
// series oficiales del Banco Central y está pensada para consumo programático
// (sin auth, sin registro). El endpoint es `/api/dolar` — el "dólar observado"
// que publica el BCCh, que es la referencia con la que se convierten precios
// en Chile.
//
// Por qué hacía falta: unos pocos anuncios de Portal Inmobiliario se publican
// en dólares. Sin tasa no se podía guardar su precio de ninguna forma honesta —
// copiar el número como si fueran pesos habría puesto una casa de USD 450.000 a
// $450.000, envenenando el precio/m², los filtros y el precio de mercado del
// cluster. Hasta ahora se guardaban sin precio.
//
// NO se fusiona con uf-rate-cl.mjs a propósito: ese archivo no tiene tests y
// lleva meses funcionando en producción; tocarlo para factorizar un fetch de
// 20 líneas sería arriesgar el camino probado del 95% de los anuncios (los que
// van en UF) para servir a un puñado. Este módulo sí trae los suyos.
// ─────────────────────────────────────────────────────────────────────────────

const MINDICADOR_URL = 'https://mindicador.cl/api/dolar'
const TIMEOUT_MS = 8000

// Cache en memoria por fecha (YYYY-MM-DD) y promesas en vuelo, para no pedir la
// misma tasa una vez por anuncio: una corrida procesa miles y el dólar
// observado es el mismo para todo el día.
const cache = new Map()
const inflight = new Map()

/** Pide la serie del dólar. Nunca lanza: devuelve {ok:true,...} o {ok:false,reason}. */
async function fetchUsdRate({ fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(MINDICADOR_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }

    const data = await res.json()
    // Forma documentada: { serie: [{ fecha: ISO8601, valor: number }, ...] },
    // con el valor más reciente primero.
    const first = Array.isArray(data?.serie) ? data.serie[0] : null
    const rate = Number(first?.valor)
    if (!first || !Number.isFinite(rate) || rate <= 0) {
      return { ok: false, reason: 'Respuesta sin serie.valor numérico válido' }
    }
    const date = String(first.fecha ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    return { ok: true, rate, date }
  } catch (err) {
    // Timeout, red caída, JSON inválido: degradar con gracia. Un anuncio sin
    // precio convertido es molesto; un scraper caído por la tasa del dólar, no.
    return { ok: false, reason: err?.message || String(err) }
  }
}

/**
 * Tasa USD→CLP del día, cacheada en memoria de proceso.
 *
 * @returns {Promise<{ ok: true, rate: number, date: string } | { ok: false, reason: string }>}
 */
export async function getUsdRateCl({ now = new Date(), fetchImpl = fetch } = {}) {
  const todayKey = now.toISOString().slice(0, 10)
  if (cache.has(todayKey)) return { ok: true, ...cache.get(todayKey) }
  if (inflight.has(todayKey)) return inflight.get(todayKey)

  const promise = (async () => {
    const result = await fetchUsdRate({ fetchImpl })
    if (result.ok) {
      cache.set(todayKey, { rate: result.rate, date: result.date })
      // También bajo la fecha real devuelta: si la API aún no publicó la de hoy
      // y responde con la de ayer, una segunda llamada no dispara otro fetch.
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

/** Limpia la cache. Solo para tests. */
export function _resetUsdRateCacheForTests() {
  cache.clear()
  inflight.clear()
}
