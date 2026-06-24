// geocode-cl.ts — geocodificación de direcciones chilenas vía Nominatim/OpenStreetMap.
// Duplicado (TS) de `scraper/lib/geocode-cl.mjs` — mismo motivo que
// `web/lib/sii-catastro-ingest.ts`: web/ y scraper/ son proyectos Node
// separados y el build Docker de web/ no incluye scraper/lib.
//
// Policy de Nominatim (https://operations.osmfoundation.org/policies/nominatim/):
// User-Agent identificable obligatorio + máximo ~1 req/s. Rate-limiter en
// memoria single-process; no coordina entre procesos.

const USER_AGENT = 'casafari-mio-web/1.0 (contacto@casafari-mio.local)'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const MIN_INTERVAL_MS = 1100
const TIMEOUT_MS = 8000

let lastRequestAt = 0
let queue: Promise<unknown> = Promise.resolve()

function scheduleNominatimCall<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt))
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastRequestAt = Date.now()
    return fn()
  }
  const result = queue.then(run, run) as Promise<T>
  queue = result.catch(() => {})
  return result
}

export interface GeoPoint {
  lat: number
  lng: number
}

async function nominatimSearch(query: string): Promise<GeoPoint | null> {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=es&countrycodes=cl`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = await res.json()
    const hit = Array.isArray(data) ? data[0] : null
    if (!hit) return null
    const lat = Number(hit.lat)
    const lng = Number(hit.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  } catch {
    return null
  }
}

export async function geocodeAddressCl({
  address,
  comuna,
  region,
}: { address?: string | null; comuna?: string | null; region?: string | null } = {}): Promise<GeoPoint | null> {
  const parts: string[] = []
  if (address) parts.push(address)
  if (comuna) parts.push(comuna)
  if (region) parts.push(region)
  parts.push('Chile')

  if (parts.length <= 1) return null

  return scheduleNominatimCall(() => nominatimSearch(parts.join(', ')))
}
