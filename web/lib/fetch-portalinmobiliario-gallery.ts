/**
 * Fetch de la galería completa de Portal Inmobiliario.
 *
 * El HTML estático de la ficha de detalle solo incrusta 5-6 fotos (primary +
 * secondary del gallery_mosaic). El resto viven en un modal de galería accesible
 * mediante una URL en `media_counters[]` (tipo 'photos'). Este módulo hace el
 * fetch a ese modal y extrae TODAS las URLs de fotos disponibles.
 */

/**
 * Fetch the gallery modal HTML and extract all photo URLs.
 * The modal URL comes from the initial JSON state in the detail page.
 */
export async function fetchPortalInmobiliarioGallery(galleryUrl: string): Promise<string[]> {
  if (!galleryUrl) return []

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000) // 10s timeout

    const response = await fetch(galleryUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      },
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) return []

    const html = await response.text()

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
