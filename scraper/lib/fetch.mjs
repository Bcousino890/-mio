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

const WHATSAPP_UA = 'WhatsApp/2.23.20.0'
// UA de navegador moderno (Chrome de escritorio reciente). Usado para portales
// sin anti-bot conocido tipo DataDome (ver comentario de cabecera).
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const PROFILES = {
  idealista: { ua: WHATSAPP_UA },
  portalinmobiliario: { ua: CHROME_UA },
}
const DEFAULT_PROFILE = 'idealista'

const TIMEOUT_S = 25

function proxyUrl() {
  // SMARTPROXY_URL: URL completa de API Smartproxy (Extracción API)
  // Ej: https://api.smartproxy.com/v2/proxy?cc=CL&city=Santiago&...
  if (process.env.SMARTPROXY_URL) {
    // Las URLs de Smartproxy API tienen formato de extracción, no proxy directo
    // Se usa para generar IPs dinámicamente, pero en curl se pasa como proxy URL
    return process.env.SMARTPROXY_URL
  }
  if (process.env.PROXY_URL) return process.env.PROXY_URL
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
  const { ua } = PROFILES[profile] ?? PROFILES[DEFAULT_PROFILE]
  return new Promise((resolve) => {
    const args = [
      '-sS', '--compressed',
      '-m', String(TIMEOUT_S),
      '-A', ua,
      '-w', '\n__HTTP_STATUS__:%{http_code}',
    ]
    const px = useProxy ? proxyUrl() : null
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
