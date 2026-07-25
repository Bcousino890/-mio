// Proxy residencial de Portal Inmobiliario, compartido entre el scraper 24/7
// (scraper/lib/fetch.mjs `proxyUrl()`) y los endpoints web que lo consultan
// bajo demanda ("Re-scrapear" de la ficha, /api/chile/parse-listing, la
// galería de fotos) — mismas variables de entorno, misma prioridad, para que
// un fetch bloqueado (403 por volumen/IP de datacenter) tenga la misma vía de
// escape en los dos lados.
export function chileProxyUrl(): string | null {
  if (process.env.SMARTPROXY_URL) return process.env.SMARTPROXY_URL
  if (process.env.PROXY_URL) return process.env.PROXY_URL
  const { EVOMI_PROXY_HOST, EVOMI_PROXY_PORT, EVOMI_PROXY_USER, EVOMI_PROXY_PASS } = process.env
  if (EVOMI_PROXY_USER) return `http://${EVOMI_PROXY_USER}:${EVOMI_PROXY_PASS}@${EVOMI_PROXY_HOST}:${EVOMI_PROXY_PORT}`
  const { SMARTPROXY_CL_HOST, SMARTPROXY_CL_PORT, SMARTPROXY_CL_USER, SMARTPROXY_CL_PASS } = process.env
  if (SMARTPROXY_CL_USER) return `http://${SMARTPROXY_CL_USER}:${SMARTPROXY_CL_PASS}@${SMARTPROXY_CL_HOST}:${SMARTPROXY_CL_PORT}`
  return null
}
