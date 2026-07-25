/**
 * Fetch de la galería completa de Portal Inmobiliario.
 *
 * El HTML estático de la ficha de detalle solo incrusta 5-6 fotos (primary +
 * secondary del gallery_mosaic). El resto viven en un modal de galería accesible
 * mediante una URL en `media_counters[]` (tipo 'photos'). Este módulo hace el
 * fetch a ese modal y extrae TODAS las URLs de fotos disponibles.
 *
 * DIRECTO primero, con fallback al proxy residencial (Evomi/SmartProxy CL) si
 * la IP del servidor viene bloqueada (403) — mismo criterio que
 * captar-pipeline.ts `fetchListingPage`. Sin esto, un bloqueo puntual dejaba
 * la ficha con solo las 5-6 fotos del HTML estático aunque el fetch de la
 * página principal sí hubiera funcionado (cayendo al proxy ahí, pero este
 * segundo fetch seguía yendo directo y se comía el 403 en silencio).
 */
import { ProxyAgent, type Dispatcher } from 'undici'
import { chileProxyUrl } from './chile-proxy'

async function fetchTextVia(url: string, proxy: string | null, ua: string): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const init: RequestInit & { dispatcher?: Dispatcher } = {
      headers: { 'User-Agent': ua },
      signal: controller.signal,
    }
    if (proxy) init.dispatcher = new ProxyAgent(proxy)
    const res = await fetch(url, init)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchTextResilient(url: string, ua: string): Promise<string | null> {
  const direct = await fetchTextVia(url, null, ua)
  if (direct) return direct
  const proxy = chileProxyUrl()
  if (!proxy) return null
  return fetchTextVia(url, proxy, ua)
}

function extractPhotosFromHtml(html: string): string[] {
  // El modal es un HTML con imágenes. Las URLs están típicamente en:
  // 1. data-zoom="<URL>" en <img> tags
  // 2. Inline en src= atributos de <img> o <picture>
  // 3. En JSON embebido similar al de la ficha principal
  const photos = new Set<string>()

  for (const m of html.matchAll(/data-zoom="(https?:\/\/[^"]+\.(?:jpg|jpeg|webp))"/gi)) photos.add(m[1])
  for (const m of html.matchAll(/src="(https?:\/\/http2\.mlstatic\.com\/[^\s"']+\.(?:jpg|jpeg|webp))"/gi)) photos.add(m[1])
  for (const m of html.matchAll(/"url":"(https?:\/\/[^"]+\.(?:jpg|jpeg|webp))"/gi)) photos.add(m[1])
  for (const m of html.matchAll(/srcset="([^"]+)"/gi)) {
    for (const url of m[1].split(',')) {
      const urlMatch = url.match(/(https?:\/\/[^\s]+\.(?:jpg|jpeg|webp))/i)
      if (urlMatch) photos.add(urlMatch[1])
    }
  }
  return Array.from(photos)
}

/**
 * Galería COMPLETA por item_id (patrón verificado en producción, espejo de
 * scraper/lib/parse-portalinmobiliario.mjs `fetchGalleryByItemId`): el modal
 * /vis-modals/gallery/{itemId} lista los IDs de TODAS las fotos; la URL
 * full-res se arma con el template D_NQ_NP_{id}-O.webp. Más fiable que
 * depender de `galleryUrl` (media_counters del blob, que a veces no viene o
 * trae menos de lo real).
 */
async function fetchGalleryByItemId(externalId: string): Promise<string[]> {
  const id = String(externalId).replace(/[^A-Z0-9]/gi, '')
  if (!/^MLC\d+$/i.test(id)) return []
  const html = await fetchTextResilient(
    `https://www.portalinmobiliario.com/vis-modals/gallery/${id}`,
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  )
  if (!html) return []
  const ids: string[] = []
  for (const m of html.matchAll(/\d{6}-MLC\d+(?:_\d{6})?/g)) if (!ids.includes(m[0])) ids.push(m[0])
  return ids.map((pid) => `https://http2.mlstatic.com/D_NQ_NP_${pid}-O.webp`)
}

/**
 * Fetch the gallery modal HTML and extract all photo URLs. `galleryUrl` viene
 * del blob (`media_counters[type=photos].url`); `externalId` (ej. "MLC-123")
 * habilita el fallback por item_id si el primero falla o no alcanza.
 */
export async function fetchPortalInmobiliarioGallery(galleryUrl: string, externalId?: string | null): Promise<string[]> {
  const photos = new Set<string>()

  if (galleryUrl) {
    try {
      const html = await fetchTextResilient(galleryUrl, 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36')
      if (html) for (const p of extractPhotosFromHtml(html)) photos.add(p)
    } catch (error) {
      console.error('Error fetching Portal Inmobiliario gallery:', error)
    }
  }

  if (externalId) {
    try {
      for (const p of await fetchGalleryByItemId(externalId)) photos.add(p)
    } catch (error) {
      console.error('Error fetching Portal Inmobiliario gallery by item id:', error)
    }
  }

  return Array.from(photos)
}
