// geocode-cl.ts — geocodificación de direcciones chilenas.
// Duplicado (TS) de `scraper/lib/geocode-cl.mjs` — mismo motivo que
// `web/lib/sii-catastro-ingest.ts`: web/ y scraper/ son proyectos Node
// separados y el build Docker de web/ no incluye scraper/lib.
//
// Dos backends:
// - Nominatim propio (NOMINATIM_URL, ej. el contenedor casafari-nominatim del
//   docker-compose) — sin límite de tasa porque es nuestra instancia, permite
//   alta concurrencia. Es el que se usa para el volumen masivo de roles SII.
// - Nominatim público de OpenStreetMap como fallback mientras el propio no
//   esté listo (import inicial tarda ~30-60 min). Su policy
//   (https://operations.osmfoundation.org/policies/nominatim/) exige
//   User-Agent identificable y un máximo ~1 req/s — NO se debe paralelizar
//   contra este endpoint bajo ningún concepto.
import { ProxyAgent, fetch as undiciFetch } from 'undici'

const USER_AGENT = 'casafari-mio-web/1.0 (contacto@casafari-mio.local)'
const PUBLIC_NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const SELF_HOSTED_URL = process.env.NOMINATIM_URL || null
const TIMEOUT_MS = 8000
const PUBLIC_MIN_INTERVAL_MS = 1100
const SELF_HOSTED_CONCURRENCY = Number(process.env.NOMINATIM_CONCURRENCY ?? 8)
const HEALTH_CHECK_INTERVAL_MS = 30_000

// Cuenta SmartProxy dedicada a Chile (SMARTPROXY_CL_*) — solo se usa contra el
// Nominatim público (rotar IP ahí es razonable); el propio es localhost/red
// docker interna, no tiene sentido ni funciona pasarlo por un proxy externo.
function proxyUrl(): string | null {
  if (process.env.PROXY_URL) return process.env.PROXY_URL
  const { SMARTPROXY_CL_HOST, SMARTPROXY_CL_PORT, SMARTPROXY_CL_USER, SMARTPROXY_CL_PASS } = process.env
  if (SMARTPROXY_CL_USER) {
    return `http://${SMARTPROXY_CL_USER}:${SMARTPROXY_CL_PASS}@${SMARTPROXY_CL_HOST}:${SMARTPROXY_CL_PORT}`
  }
  return null
}

let selfHostedHealthy = false
let lastHealthCheckAt = 0

async function isSelfHostedReady(): Promise<boolean> {
  if (!SELF_HOSTED_URL) return false
  const now = Date.now()
  if (now - lastHealthCheckAt < HEALTH_CHECK_INTERVAL_MS) return selfHostedHealthy
  lastHealthCheckAt = now
  try {
    const statusUrl = SELF_HOSTED_URL.replace(/\/search$/, '/status')
    const res = await undiciFetch(statusUrl, { signal: AbortSignal.timeout(3000) })
    selfHostedHealthy = res.ok
  } catch {
    selfHostedHealthy = false
  }
  return selfHostedHealthy
}

// Pacing serializado para el endpoint público — respeta el límite de policy.
let lastPublicRequestAt = 0
let publicQueue: Promise<unknown> = Promise.resolve()

function schedulePublicCall<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = Math.max(0, PUBLIC_MIN_INTERVAL_MS - (Date.now() - lastPublicRequestAt))
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastPublicRequestAt = Date.now()
    return fn()
  }
  const result = publicQueue.then(run, run) as Promise<T>
  publicQueue = result.catch(() => {})
  return result
}

// Limitador de concurrencia (sin pacing) para el Nominatim propio.
let selfHostedActive = 0
const selfHostedWaiting: Array<() => void> = []

function acquireSelfHostedSlot(): Promise<void> {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (selfHostedActive < SELF_HOSTED_CONCURRENCY) {
        selfHostedActive++
        resolve()
      } else {
        selfHostedWaiting.push(tryAcquire)
      }
    }
    tryAcquire()
  })
}

function releaseSelfHostedSlot() {
  selfHostedActive--
  const next = selfHostedWaiting.shift()
  if (next) next()
}

async function scheduleSelfHostedCall<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSelfHostedSlot()
  try {
    return await fn()
  } finally {
    releaseSelfHostedSlot()
  }
}

export interface GeoPoint {
  lat: number
  lng: number
}

async function nominatimSearch(query: string, baseUrl: string, useProxy: boolean): Promise<GeoPoint | null> {
  const url = `${baseUrl}?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=es&countrycodes=cl`
  try {
    const px = useProxy ? proxyUrl() : null
    const res = await undiciFetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      dispatcher: px ? new ProxyAgent(px) : undefined,
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
  const query = parts.join(', ')

  if (await isSelfHostedReady()) {
    return scheduleSelfHostedCall(() => nominatimSearch(query, SELF_HOSTED_URL!, false))
  }
  return schedulePublicCall(() => nominatimSearch(query, PUBLIC_NOMINATIM_URL, true))
}
