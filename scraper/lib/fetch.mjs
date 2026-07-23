// ─────────────────────────────────────────────────────────────────────────────
// Fetch de HTML vía curl, con un perfil de User-Agent por portal.
//
// Idealista (perfil 'idealista', y el comportamiento POR DEFECTO si no se pasa
// `profile`): DataDome (el anti-bot de Idealista) tiene en whitelist el bot de
// WhatsApp, porque en España se comparten enlaces de Idealista por WhatsApp de
// forma masiva y bloquear sus previews rompería esa función. Hay que usar curl
// (no fetch/undici): DataDome valida también el TLS fingerprint (JA3) además
// del UA — el de curl + UA WhatsApp pasa de forma consistente.
//
// Portalinmobiliario (perfil 'portalinmobiliario'): no hay evidencia de un
// anti-bot tipo DataDome (ver docs/research-portalinmobiliario-chile.md), así
// que basta un UA de navegador normal — el truco de WhatsApp es específico de
// Idealista y no aporta nada aquí. Pendiente de confirmar con un spike real de
// red contra el dominio en producción (el sandbox de investigación bloqueó el
// fetch directo).
//
// IMPORTANTE: `fetchHtml(url, { useProxy })` sin `profile` debe seguir
// comportándose EXACTAMENTE igual que antes (UA de WhatsApp) — no romper el
// scraping de Idealista que ya funciona en producción.
//
// Si se define PROXY_URL (residencial), se enruta a través de él para repartir
// la carga entre IPs y evitar rate-limit por volumen.
// ─────────────────────────────────────────────────────────────────────────────
import { execFile } from 'node:child_process'
import { withResilience } from './resilient-fetch.mjs'

const WHATSAPP_UA = 'WhatsApp/2.23.20.0'
// UA de navegador moderno (Chrome de escritorio reciente). Usado para portales
// sin anti-bot conocido tipo DataDome (ver comentario de cabecera).
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Portalinmobiliario sirve DOS variantes de HTML según los headers de la
// petición: con solo el UA devuelve una variante "ligera" (polycards
// renderizadas en servidor, SIN el blob Nordic ni permalinks navegables — el
// parser saca 0). Con headers de navegador completos (Accept, Accept-Language,
// Upgrade-Insecure-Requests) + seguir redirects, devuelve la variante con el
// blob `__NORDIC_RENDERING_CTX__` que trae precio, corredora, m², permalinks —
// la que parse-portalinmobiliario.mjs entiende. Verificado contra HTML real de
// Las Condes (48 tarjetas + total=3469). Misma técnica que el scraper de
// captaciones en producción (smartbc).
const PI_HEADERS = [
  'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language: es-CL,es;q=0.9',
  'Upgrade-Insecure-Requests: 1',
]

const PROFILES = {
  idealista: { ua: WHATSAPP_UA },
  portalinmobiliario: { ua: CHROME_UA, headers: PI_HEADERS, followRedirects: true },
}
const DEFAULT_PROFILE = 'idealista'

const TIMEOUT_S = 25

function proxyUrl(profile) {
  // SMARTPROXY_URL: URL completa de API Smartproxy (Extracción API)
  // Ej: https://api.smartproxy.com/v2/proxy?cc=CL&city=Santiago&...
  if (process.env.SMARTPROXY_URL) {
    // Las URLs de Smartproxy API tienen formato de extracción, no proxy directo
    // Se usa para generar IPs dinámicamente, pero en curl se pasa como proxy URL
    return process.env.SMARTPROXY_URL
  }
  if (process.env.PROXY_URL) return process.env.PROXY_URL

  // Evomi (residencial, geo Chile) — proxy ACTIVO del plan Anuncios CL (H10),
  // reemplaza a SmartProxy/Geonode para el barrido de Portal Inmobiliario.
  // Prioridad sobre SMARTPROXY_CL_* (que queda como fallback legacy, ver
  // docs/PLAN-ANUNCIOS-CL.md §4 H10) — mismo criterio que SMARTPROXY_URL/
  // PROXY_URL arriba: si está configurado, gana.
  if (profile === 'portalinmobiliario') {
    const { EVOMI_PROXY_HOST, EVOMI_PROXY_PORT, EVOMI_PROXY_USER, EVOMI_PROXY_PASS } = process.env
    if (EVOMI_PROXY_USER) {
      return `http://${EVOMI_PROXY_USER}:${EVOMI_PROXY_PASS}@${EVOMI_PROXY_HOST}:${EVOMI_PROXY_PORT}`
    }
  }

  // Cuenta SmartProxy dedicada a Chile (geo-targeting CL/Santiago), separada
  // de la cuenta SMARTPROXY_PROXY_* de España/Idealista para no mezclarlas.
  // Fallback legacy si Evomi no está configurado (ver arriba).
  if (profile === 'portalinmobiliario') {
    const { SMARTPROXY_CL_HOST, SMARTPROXY_CL_PORT, SMARTPROXY_CL_USER, SMARTPROXY_CL_PASS } = process.env
    if (SMARTPROXY_CL_USER) {
      return `http://${SMARTPROXY_CL_USER}:${SMARTPROXY_CL_PASS}@${SMARTPROXY_CL_HOST}:${SMARTPROXY_CL_PORT}`
    }
  }

  const { PROXY_PROVIDER, SMARTPROXY_PROXY_HOST, SMARTPROXY_PROXY_PORT,
          SMARTPROXY_PROXY_USER, SMARTPROXY_PROXY_PASS,
          GEONODE_PROXY_HOST, GEONODE_PROXY_PORT, GEONODE_PROXY_USER, GEONODE_PROXY_PASS } = process.env
  if (PROXY_PROVIDER === 'smartproxy' && SMARTPROXY_PROXY_USER) {
    return `http://${SMARTPROXY_PROXY_USER}:${SMARTPROXY_PROXY_PASS}@${SMARTPROXY_PROXY_HOST}:${SMARTPROXY_PROXY_PORT}`
  }
  if (PROXY_PROVIDER === 'geonode' && GEONODE_PROXY_USER) {
    return `http://${GEONODE_PROXY_USER}:${GEONODE_PROXY_PASS}@${GEONODE_PROXY_HOST}:${GEONODE_PROXY_PORT}`
  }
  return null
}

/**
 * Descarga el HTML de una URL. Devuelve { ok, html } o
 * { ok: false, status, reason }.
 *
 * `profile` selecciona el User-Agent (y futuros ajustes específicos de
 * portal) vía el mapa PROFILES. Por defecto usa 'idealista' (UA de WhatsApp),
 * idéntico al comportamiento histórico de esta función.
 */
export function fetchHtml(url, { useProxy = true, profile = DEFAULT_PROFILE } = {}) {
  const { ua, headers = [], followRedirects = false } = PROFILES[profile] ?? PROFILES[DEFAULT_PROFILE]
  return new Promise((resolve) => {
    const args = [
      '-sS', '--compressed',
      '-m', String(TIMEOUT_S),
      '-A', ua,
      '-w', '\n__HTTP_STATUS__:%{http_code}',
    ]
    // Seguir redirects (-L) y headers extra del perfil. Portalinmobiliario los
    // necesita para servir la variante con el blob Nordic (ver PI_HEADERS);
    // Idealista no define ninguno → se comporta EXACTAMENTE igual que antes.
    if (followRedirects) args.push('-L')
    for (const h of headers) args.push('-H', h)
    const px = useProxy ? proxyUrl(profile) : null
    if (px) args.push('-x', px)
    args.push(url)

    execFile('curl', args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        return resolve({ ok: false, status: 0, reason: stderr || err.message })
      }
      const m = stdout.match(/\n__HTTP_STATUS__:(\d+)\s*$/)
      const status = m ? Number(m[1]) : 0
      const html = m ? stdout.slice(0, m.index) : stdout
      if (status !== 200) {
        return resolve({ ok: false, status, reason: `HTTP ${status}` })
      }
      if (!html || html.length < 500) {
        return resolve({ ok: false, status, reason: 'HTML vacío/corto' })
      }
      resolve({ ok: true, html })
    })
  })
}

export const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Fetch de Portal Inmobiliario con estrategia DIRECTO-primero, proxy-fallback.
 * Verificado en Fase 0: el fetch directo trae la variante con el blob Nordic sin
 * bloqueos (PI no tiene anti-bot agresivo tipo DataDome). Enrutar todo por el
 * residencial Evomi es más frágil (IP residencial puede recibir otra variante o
 * bloqueo) y era la causa de que el barrido no ingresara datos. Se prueba directo
 * y SOLO si falla (bloqueo/429/HTML corto) se reintenta por Evomi — reservando el
 * proxy para cuando de verdad hace falta (criterio del plan H10). Es UN intento
 * lógico para el circuit-breaker de withResilience (que envuelve esta función).
 */
async function fetchHtmlPi(url, { profile = 'portalinmobiliario' } = {}) {
  // "Éxito" para PI NO es solo HTTP 200: la variante LIGERA que PI sirve a
  // algunas IPs (p. ej. datacenter) responde 200 pero SIN el blob Nordic, y el
  // parser saca 0. Solo cuenta como bueno si trae el blob. Así, si el directo
  // (IP de la VPS) recibe la variante ligera, se cae a Evomi (residencial CL),
  // que suele recibir la buena — en vez de aceptar un 200 inútil.
  const hasBlob = (r) => r.ok && typeof r.html === 'string' && r.html.includes('__NORDIC_RENDERING_CTX__')

  const direct = await fetchHtml(url, { useProxy: false, profile })
  if (hasBlob(direct)) return direct

  const proxied = await fetchHtml(url, { useProxy: true, profile })
  if (hasBlob(proxied)) return proxied

  // Ninguna vía trajo el blob. Devolvemos el mejor 200 disponible (para no
  // disparar el circuit-breaker con un falso "caído"), marcando el motivo.
  if (proxied.ok) return { ...proxied, reason: 'sin blob Nordic (variante ligera)' }
  if (direct.ok) return { ...direct, reason: 'sin blob Nordic (variante ligera)' }
  return direct
}

/**
 * fetchHtml + reintentos con backoff exponencial + circuit-breaker por
 * dominio (plan Anuncios CL · H16, ver resilient-fetch.mjs). Aditivo: no
 * cambia el comportamiento de `fetchHtml` — pensado para el discovery
 * crawler/worker 24/7 de Chile (H1/H2), que corren sin supervisión y no
 * pueden quedarse reintentando a ciegas un dominio caído.
 *
 * @param {string} url
 * @param {{ useProxy?: boolean, profile?: string, retries?: number, baseBackoffMs?: number, failureThreshold?: number, cooldownMs?: number }} [options]
 */
export function fetchHtmlResilient(url, options = {}) {
  const { useProxy, profile, ...resilienceOptions } = options
  // Portal Inmobiliario, sin useProxy explícito: directo-primero con fallback a
  // Evomi (fetchHtmlPi). Es lo que hace que el barrido ingrese datos de forma
  // fiable en vez de depender de que el residencial devuelva la variante buena.
  if (profile === 'portalinmobiliario' && useProxy === undefined) {
    return withResilience(fetchHtmlPi, url, { ...resilienceOptions, fetchOpts: { profile } })
  }
  return withResilience(fetchHtml, url, { ...resilienceOptions, fetchOpts: { useProxy, profile } })
}
