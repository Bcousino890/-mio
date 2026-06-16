// ─────────────────────────────────────────────────────────────────────────────
// Fetch de HTML de Idealista vía curl con el User-Agent de WhatsApp.
//
// DataDome (el anti-bot de Idealista) tiene en whitelist el bot de WhatsApp,
// porque en España se comparten enlaces de Idealista por WhatsApp de forma
// masiva y bloquear sus previews rompería esa función. Hay que usar curl (no
// fetch/undici): DataDome valida también el TLS fingerprint (JA3) además del
// UA — el de curl + UA WhatsApp pasa de forma consistente.
//
// Si se define PROXY_URL (residencial), se enruta a través de él para repartir
// la carga entre IPs y evitar rate-limit por volumen.
// ─────────────────────────────────────────────────────────────────────────────
import { execFile } from 'node:child_process'

const WHATSAPP_UA = 'WhatsApp/2.23.20.0'
const TIMEOUT_S = 25

function proxyUrl() {
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
 * Descarga el HTML de una URL de Idealista. Devuelve { ok, html } o
 * { ok: false, status, reason }.
 */
export function fetchHtml(url, { useProxy = true } = {}) {
  return new Promise((resolve) => {
    const args = [
      '-sS', '--compressed',
      '-m', String(TIMEOUT_S),
      '-A', WHATSAPP_UA,
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
