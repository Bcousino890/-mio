import { ProxyAgent, type Dispatcher } from 'undici'

/**
 * Fetch de la galería completa de Portal Inmobiliario.
 *
 * El HTML estático de la ficha de detalle solo incrusta 5-6 fotos (primary +
 * secondary del gallery_mosaic). El resto viven en un modal de galería accesible
 * mediante una URL en `media_counters[]` (tipo 'photos'). Este módulo hace el
 * fetch a ese modal y extrae TODAS las URLs de fotos disponibles.
 *
 * Root-cause del bug "solo se scrapean 5 fotos" al usar "Re-scrapear" desde la
 * ficha: este fetch era directo, sin ningún fallback. Cuando el bloqueo del
 * portal (403 / IP de datacenter) le pega a este endpoint del modal (no solo
 * al de la ficha principal, ver captar-pipeline.ts `fetchListingPage`), el
 * catch mudo de abajo devolvía [] y la ficha quedaba pegada en las 5 fotos del
 * HTML estático — sin aviso. Mismo criterio directo-primero + fallback a
 * proxy residencial (Evomi/SmartProxy CL) que el resto del pipeline de Chile.
 */

// Mismas variables de entorno y misma prioridad que scraper/lib/fetch.mjs
// (proxyUrl()) y captar-pipeline.ts (chileProxyUrl()) — un solo criterio
// compartido en todo el proyecto para elegir el proxy residencial de Chile.
function chileProxyUrl(): string | null {
  if (process.env.SMARTPROXY_URL) return process.env.SMARTPROXY_URL
  if (process.env.PROXY_URL) return process.env.PROXY_URL
  const { EVOMI_PROXY_HOST, EVOMI_PROXY_PORT, EVOMI_PROXY_USER, EVOMI_PROXY_PASS } = process.env
  if (EVOMI_PROXY_USER) return `http://${EVOMI_PROXY_USER}:${EVOMI_PROXY_PASS}@${EVOMI_PROXY_HOST}:${EVOMI_PROXY_PORT}`
  const { SMARTPROXY_CL_HOST, SMARTPROXY_CL_PORT, SMARTPROXY_CL_USER, SMARTPROXY_CL_PASS } = process.env
  if (SMARTPROXY_CL_USER) return `http://${SMARTPROXY_CL_USER}:${SMARTPROXY_CL_PASS}@${SMARTPROXY_CL_HOST}:${SMARTPROXY_CL_PORT}`
  return null
}

async function fetchGalleryHtmlVia(url: string, proxy: string | null): Promise<{ ok: boolean; html: string }> {
  const init: RequestInit & { dispatcher?: Dispatcher } = {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(10000),
  }
  if (proxy) init.dispatcher = new ProxyAgent(proxy)
  const response = await fetch(url, init)
  return { ok: response.ok, html: response.ok ? await response.text() : '' }
}

/**
 * Fetch the gallery modal HTML and extract all photo URLs.
 * The modal URL comes from the initial JSON state in the detail page.
 */
export async function fetchPortalInmobiliarioGallery(galleryUrl: string): Promise<string[]> {
  if (!galleryUrl) return []

  try {
    let html = ''
    try {
      const direct = await fetchGalleryHtmlVia(galleryUrl, null)
      if (direct.ok) html = direct.html
    } catch {
      // sigue al proxy abajo
    }
    if (!html) {
      const proxy = chileProxyUrl()
      if (proxy) {
        const proxied = await fetchGalleryHtmlVia(galleryUrl, proxy)
        if (proxied.ok) html = proxied.html
      }
    }
    if (!html) return []

    // El modal es un HTML con imágenes. Las URLs están típicamente en:
    // 1. data-zoom="<URL>" en <img> tags
    // 2. Inline en src= atributos de <img> o <picture>
    // 3. En JSON embebido similar al de la ficha principal

    const photos = new Set<string>()

    // Patrón 1: data-zoom (carrusel/galería)
    for (const m of html.matchAll(/data-zoom="(https?:\/\/[^"]+\.(?:jpg|jpeg|webp))"/gi)) {
      photos.add(m[1])
    }

    // Patrón 2: img src con mlstatic (resolución completa)
    for (const m of html.matchAll(/src="(https?:\/\/http2\.mlstatic\.com\/[^\s"']+\.(?:jpg|jpeg|webp))"/gi)) {
      photos.add(m[1])
    }

    // Patrón 3: URLs en JSON embebido (si existen)
    for (const m of html.matchAll(/"url":"(https?:\/\/[^"]+\.(?:jpg|jpeg|webp))"/gi)) {
      photos.add(m[1])
    }

    // Patrón 4: srcset (pueden contener múltiples resoluciones)
    for (const m of html.matchAll(/srcset="([^"]+)"/gi)) {
      const srcset = m[1]
      for (const url of srcset.split(',')) {
        const urlMatch = url.match(/(https?:\/\/[^\s]+\.(?:jpg|jpeg|webp))/i)
        if (urlMatch) photos.add(urlMatch[1])
      }
    }

    return Array.from(photos)
  } catch (error) {
    console.error('Error fetching Portal Inmobiliario gallery:', error)
    return []
  }
}
