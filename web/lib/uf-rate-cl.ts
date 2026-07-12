// ─────────────────────────────────────────────────────────────────────────────
// Tasa UF (Unidad de Fomento) → CLP del día, vía mindicador.cl — versión web.
//
// Espejo del helper de scraper (`scraper/lib/uf-rate-cl.mjs`): mindicador.cl es
// una API pública gratuita pensada para consumo programático (sin auth) que
// republica la serie oficial de UF del Banco Central. Se usa en el AVM para
// convertir el valor de suelo UF/m² de MINVU (mercado_agregado_cl) a CLP.
//
// Nunca lanza: si mindicador.cl falla, devuelve null y el caller degrada con
// gracia (muestra la banda en UF sin conversión a CLP).
// ─────────────────────────────────────────────────────────────────────────────

const MINDICADOR_URL = 'https://mindicador.cl/api/uf'
const TIMEOUT_MS = 6000

let cache: { rate: number; date: string; key: string } | null = null
let inflight: Promise<{ rate: number; date: string } | null> | null = null

async function fetchUfRate(): Promise<{ rate: number; date: string } | null> {
  try {
    const res = await fetch(MINDICADOR_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = await res.json()
    const first = Array.isArray(data?.serie) ? data.serie[0] : null
    const rate = Number(first?.valor)
    if (!first || !Number.isFinite(rate) || rate <= 0) return null
    const date = String(first.fecha ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    return { rate, date }
  } catch {
    return null
  }
}

/**
 * Tasa UF→CLP del día (memoizada en memoria de proceso por fecha). Devuelve
 * `{ rate, date }` o `null` si mindicador.cl no responde.
 */
export async function getUfRateCl(): Promise<{ rate: number; date: string } | null> {
  const todayKey = new Date().toISOString().slice(0, 10)
  if (cache && cache.key === todayKey) return { rate: cache.rate, date: cache.date }
  if (inflight) return inflight

  inflight = (async () => {
    const result = await fetchUfRate()
    if (result) cache = { rate: result.rate, date: result.date, key: todayKey }
    inflight = null
    return result
  })()
  return inflight
}
