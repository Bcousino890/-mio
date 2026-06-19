// ─────────────────────────────────────────────────────────────────────────────
// CRM Photo Extractors
//
// Funciones especializadas para extraer fotos desde cada plataforma CRM.
// No persisten en BD, solo extraen y retornan URLs absolutas de fotos.
//
// Cada extractor:
// 1. Recibe HTML de la página y baseUrl (para resolver URLs relativas)
// 2. Retorna array de URLs de fotos (absolutas)
// 3. Maneja watermarks/transformaciones específicas de cada CRM
// 4. Incluye fallbacks si la estructura HTML cambia
//
// Uso:
//   const photos = extractPhotosFromMobilia(html, 'https://www.agencia.es/');
//   const photos = extractPhotosFromInmoweb(html, 'https://tuagencia.es/');
//   const photos = extractPhotosFromLevel(html, 'https://agencia.es/');
//   const photos = extractPhotosFromFotocasa(html, 'https://agencia.es/');
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resuelve una URL relativa contra baseUrl (si es necesario).
 * @param {string} url - URL relativa o absoluta
 * @param {string} baseUrl - URL base para resolver relativas
 * @returns {string} URL absoluta
 */
function resolveUrl(url, baseUrl) {
  if (!url) return null
  try {
    // Si ya es absoluta, devolverla
    if (/^https?:\/\//.test(url)) return url

    // Si es protocolo relativo (//example.com), añadir protocolo
    if (/^\/\//.test(url)) {
      const baseProtocol = baseUrl.match(/^https?/)[0]
      return `${baseProtocol}:${url}`
    }

    // Si es ruta relativa (/path o path), resolver contra baseUrl
    const base = new URL(baseUrl)
    if (url.startsWith('/')) {
      return new URL(url, base).href
    } else {
      return new URL(url, base.href.endsWith('/') ? base.href : base.href + '/').href
    }
  } catch {
    return null
  }
}

/**
 * Extrae todas las URLs de imágenes de atributos HTML comunes.
 * Usado como fallback en todos los extractores.
 * @param {string} html - HTML de la página
 * @returns {Set<string>} Set de URLs encontradas
 */
function extractImageUrlsFromHtml(html) {
  const urls = new Set()

  // Buscar <img src="...">
  for (const match of html.matchAll(/<img[^>]+src="([^"]+)"/gi)) {
    const url = match[1]
    if (url && /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url)) {
      urls.add(url)
    }
  }

  // Buscar <img data-src="..."> (lazy loading)
  for (const match of html.matchAll(/<img[^>]+data-src="([^"]+)"/gi)) {
    const url = match[1]
    if (url && /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url)) {
      urls.add(url)
    }
  }

  // Buscar <img data-original="...">
  for (const match of html.matchAll(/<img[^>]+data-original="([^"]+)"/gi)) {
    const url = match[1]
    if (url && /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url)) {
      urls.add(url)
    }
  }

  // Buscar <source srcset="..."> en <picture>
  for (const match of html.matchAll(/<source[^>]+srcset="([^"]+)"/gi)) {
    const srcset = match[1]
    // srcset puede tener múltiples URLs: "url1.jpg 1x, url2.jpg 2x"
    for (const entry of srcset.split(',')) {
      const url = entry.split(/\s+/)[0].trim()
      if (url && /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url)) {
        urls.add(url)
      }
    }
  }

  // Buscar background-image: url(...)
  for (const match of html.matchAll(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/gi)) {
    const url = match[1]
    if (url && /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url)) {
      urls.add(url)
    }
  }

  // Buscar data-image, data-bg, data-background
  for (const match of html.matchAll(/data-(?:image|bg|background)="([^"]+)"/gi)) {
    const url = match[1]
    if (url && /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url)) {
      urls.add(url)
    }
  }

  // Buscar URLs en JSON embebido (__NEXT_DATA__, config, etc.)
  for (const match of html.matchAll(/["'](?:url|imageUrl|image_url|src)["']\s*:\s*["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/gi)) {
    const url = match[1]
    if (url && /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url)) {
      urls.add(url)
    }
  }

  return Array.from(urls)
}

/**
 * Filtra URLs que probablemente no sean fotos de la propiedad.
 * @param {string[]} urls - URLs a filtrar
 * @returns {string[]} URLs filtradas
 */
function filterNonPropertyImages(urls) {
  const excludeKeywords = [
    'logo', 'icon', 'favicon', 'avatar', 'agency', 'brand', 'marker',
    'placeholder', 'loading', 'no-image', 'noimage', 'banner',
    'stamp', 'sello', 'quality', 'flag', 'flags',
    'spinner', 'loader', 'watermark'
  ]

  return urls.filter(url => {
    // Excluir SVGs (iconografía)
    if (/\.svg(?:[?#]|$)/i.test(url)) return false

    // Excluir data: URLs
    if (/^data:/i.test(url)) return false

    // Excluir por palabras clave
    const lower = url.toLowerCase()
    if (excludeKeywords.some(kw => lower.includes(kw))) return false

    // Excluir rutas de mapas
    if (lower.includes('/maps/') || lower.includes('google-maps')) return false

    return true
  })
}

/**
 * Extrae fotos desde Mobilia (media.mobiliagestion.es).
 *
 * Mobilia usa estructura:
 * - Host: media.mobiliagestion.es
 * - Path: /Images/{ref}/photo.jpg
 * - Watermark removal: .jpg → -original.jpg
 *
 * HTML típicamente tiene <img data-original="..." src="..."> o solo src.
 *
 * @param {string} html - HTML de la página de Mobilia
 * @param {string} baseUrl - URL base para resolver relativas
 * @returns {string[]} Array de URLs de fotos (absolutas, sin watermark)
 */
export function extractPhotosFromMobilia(html, baseUrl) {
  if (!html || typeof html !== 'string') return []

  const photos = new Set()

  // Extractor específico: buscar <img> dentro de contenedores de galería
  // Mobilia típicamente usa class="gallery" o clase similar para la galería
  const galleryMatches = html.match(
    /(?:class="[^"]*gallery[^"]*"|id="[^"]*gallery[^"]*"|class="[^"]*photo[^"]*")[^>]*>[\s\S]{0,3000}?(?=<\/(?:div|section)>)/gi
  )

  if (galleryMatches && galleryMatches.length > 0) {
    for (const gallery of galleryMatches) {
      // En cada bloque de galería, extraer imágenes con prioridad: data-original > data-src > src
      // Solo usar uno de ellos por <img>, no todos

      // Buscar tags <img>
      for (const match of gallery.matchAll(/<img[^>]*>/gi)) {
        const img = match[0]

        // Intenta obtener URL en orden de prioridad
        let url = null

        // 1. Preferir data-original (ya sin watermark)
        let dataOrigMatch = img.match(/data-original="([^"]+)"/)
        if (dataOrigMatch) {
          url = dataOrigMatch[1]
        } else {
          // 2. Fallback a data-src
          let dataSrcMatch = img.match(/data-src="([^"]+)"/)
          if (dataSrcMatch) {
            url = dataSrcMatch[1]
          } else {
            // 3. Fallback a src
            let srcMatch = img.match(/src="([^"]+)"/)
            if (srcMatch) {
              url = srcMatch[1]
            }
          }
        }

        if (url && /\.jpe?g/i.test(url)) {
          url = resolveUrl(url, baseUrl)
          if (url && url.includes('media.mobiliagestion.es') && url.includes('/Images/')) {
            photos.add(url)
          }
        }
      }
    }
  }

  // Fallback: si la galería específica no se encontró, extraer de todo el HTML
  if (photos.size === 0) {
    const allUrls = extractImageUrlsFromHtml(html)
    for (let url of allUrls) {
      url = resolveUrl(url, baseUrl)
      if (url && url.includes('media.mobiliagestion.es') && url.includes('/Images/')) {
        // Filtrar: descartar si tiene "Flags", "thumb", etc.
        if (!url.includes('Flags') && !/-thumb/.test(url) && !/-original/.test(url)) {
          photos.add(url)
        }
      }
    }
  }

  // Transformación: convertir a versión sin watermark
  // media.mobiliagestion.es/Images/{ref}/photo.jpg → .../photo-original.jpg
  // (Solo aplicar si no termina ya en -original)
  return Array.from(photos).map(url => {
    // Si ya tiene -original, no transformar de nuevo
    if (/-original\.(jpe?g)$/i.test(url)) {
      return url
    }
    return url.replace(/\.jpe?g(?=[?#]|$)/i, (match) => {
      const ext = match.toLowerCase()
      return `-original${ext}`
    })
  }).slice(0, 40)
}

/**
 * Extrae fotos desde Inmoweb (multi-tenant, dominios variables).
 *
 * Inmoweb es multi-tenant: cada agencia puede tener su propio dominio.
 * URLs de fotos típicamente contienen:
 * - /images/, /imagenes/, /fotos/, /photos/
 * - /uploads/, /inmuebles/, /properties/
 * - /galeria/, /gallery/, /media/
 *
 * Transformación: remover sufijos de thumbnail
 * - /thumbs/ o /thumbnail/ o -thumb → removidos
 * - -small, -sm, -mini → removidos
 *
 * HTML usa <source srcset>, <img>, <a href> para lightbox.
 *
 * @param {string} html - HTML de la página de Inmoweb
 * @param {string} baseUrl - URL base para resolver relativas
 * @returns {string[]} Array de URLs de fotos (absolutas, sin thumbnail)
 */
export function extractPhotosFromInmoweb(html, baseUrl) {
  if (!html || typeof html !== 'string') return []

  const photos = new Set()

  // Palabras clave que indican una ruta de fotos en Inmoweb
  const photoPathKeywords = [
    '/images/', '/imagenes/', '/fotos/', '/photos/',
    '/uploads/', '/inmuebles/', '/properties/',
    '/galeria/', '/gallery/', '/media/'
  ]

  // Buscar <picture> con <source srcset> (patrón principal de Inmoweb)
  const pictureMatches = html.match(/<picture[^>]*>[\s\S]*?<\/picture>/gi)
  if (pictureMatches && pictureMatches.length > 0) {
    for (const picture of pictureMatches) {
      // Extraer todas las URLs de srcset
      for (const match of picture.matchAll(/srcset="([^"]+)"/gi)) {
        const srcset = match[1]
        // srcset puede tener múltiples entradas: "url1 1x, url2 2x"
        for (const entry of srcset.split(',')) {
          // URL se encuentra antes del primer espacio (que separa URL del descriptor)
          let url = entry.trim().split(/\s+/)[0].trim()
          if (url && /\.(?:jpe?g|png|webp)(?:[?#@]|$)/i.test(url)) {
            url = resolveUrl(url, baseUrl)
            if (url && photoPathKeywords.some(kw => url.includes(kw))) {
              photos.add(url)
            }
          }
        }
      }

      // Extraer src de <img> dentro de <picture>
      for (const match of picture.matchAll(/<img[^>]+src="([^"]+)"/gi)) {
        let url = match[1]
        if (url && /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url)) {
          url = resolveUrl(url, baseUrl)
          if (url && photoPathKeywords.some(kw => url.includes(kw))) {
            photos.add(url)
          }
        }
      }
    }
  }

  // Fallback: buscar <img> con data-src (lazy loading)
  for (const match of html.matchAll(/<img[^>]*data-src="([^"]+)"/gi)) {
    let url = match[1]
    if (url && /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url)) {
      url = resolveUrl(url, baseUrl)
      if (url && photoPathKeywords.some(kw => url.includes(kw))) {
        photos.add(url)
      }
    }
  }

  // Fallback: buscar <a> con href (lightbox pattern)
  // Típicamente: <a href="...large.jpg" class="gallery"> o similar
  for (const match of html.matchAll(/<a[^>]+href="([^"]+\.(?:jpe?g|png|webp))"[^>]*class="[^"]*(?:gallery|lightbox|image|photo)[^"]*"/gi)) {
    let url = match[1]
    if (url) {
      url = resolveUrl(url, baseUrl)
      if (url && photoPathKeywords.some(kw => url.includes(kw))) {
        photos.add(url)
      }
    }
  }

  // Fallback: todos los <img> si aún no tenemos fotos
  if (photos.size === 0) {
    const allUrls = extractImageUrlsFromHtml(html)
    for (const rawUrl of allUrls) {
      let url = resolveUrl(rawUrl, baseUrl)
      if (url && photoPathKeywords.some(kw => url.includes(kw))) {
        photos.add(url)
      }
    }
  }

  // Transformación: remover sufijos de thumbnail (conservador: solo si existen variantes)
  const thumbPatterns = [
    /\/thumbs\//i,
    /\/thumbnail\//i,
    /\/thumbnails\//i,
    /-thumb(?=\.[a-z]+(?:$|[?#]))/i,
    /-thumbnail(?=\.[a-z]+(?:$|[?#]))/i,
    /[-_]small(?=\.[a-z]+(?:$|[?#]))/i,
    /[-_]sm(?=\.[a-z]+(?:$|[?#]))/i,
    /[-_]mini(?=\.[a-z]+(?:$|[?#]))/i,
  ]

  const result = Array.from(photos).map(url => {
    let cleaned = url
    for (const pattern of thumbPatterns) {
      if (pattern.test(cleaned)) {
        cleaned = cleaned.replace(pattern, '')
      }
    }
    return cleaned
  })

  return filterNonPropertyImages(result).slice(0, 40)
}

/**
 * Extrae fotos desde Level Real Estate.
 *
 * Level usa Mobilia como backend de media:
 * - Host: media.mobiliagestion.es
 * - Path: /Images/{ref}/
 *
 * Level es white-label de Mobilia, así que delega a extractPhotosFromMobilia
 * pero además filtra por la referencia específica de la propiedad.
 *
 * HTML típicamente incluye data de Elementor (page builder).
 *
 * @param {string} html - HTML de la página de Level
 * @param {string} baseUrl - URL base para resolver relativas
 * @returns {string[]} Array de URLs de fotos (absolutas, sin watermark)
 */
export function extractPhotosFromLevel(html, baseUrl) {
  if (!html || typeof html !== 'string') return []

  // Extraer la referencia de la propiedad desde la URL (property-ref-{ref})
  const refMatch = baseUrl.match(/property-ref-(\d+)/)
  const propertyRef = refMatch ? refMatch[1] : null

  // Level usa Mobilia como backend, así que aplicar el mismo extractor
  let photos = extractPhotosFromMobilia(html, baseUrl)

  // Filtro adicional: si tenemos referencia, asegurar que las fotos son del right ref
  if (propertyRef) {
    photos = photos.filter(url => {
      // Las URLs de Mobilia tienen formato: .../Images/{ref}/photo-original.jpg
      return url.includes(`/Images/${propertyRef}/`) || url.includes(`/Images/${propertyRef}%2F`)
    })
  }

  // Si no encontramos con la estructura Mobilia, intentar fallback con búsqueda genérica
  if (photos.length === 0) {
    const allUrls = extractImageUrlsFromHtml(html)
    const mobiliaUrls = allUrls.filter(url => {
      url = resolveUrl(url, baseUrl)
      return url && url.includes('media.mobiliagestion.es') && url.includes('/Images/')
    })

    if (mobiliaUrls.length > 0) {
      photos = mobiliaUrls.map(url => {
        return url.replace(/\.jpe?g(?=[?#]|$)/i, (match) => {
          const ext = match.toLowerCase()
          return `-original${ext}`
        })
      }).slice(0, 40)
    }
  }

  return photos
}

/**
 * Extrae fotos desde Fotocasa.
 *
 * Fotocasa usa múltiples CDNs:
 * - static.fotocasa.es, image.fotocasa.es, images.fotocasa.es
 * - cdn.fotocasa.es, media.fotocasa.es
 * - ixpimg.com (más reciente)
 *
 * Rutas típicas:
 * - /images/ads/{uuid}
 * - /images/client/{uuid}
 * - Variantes de tamaño: ?rule=web_412x257 → ?rule=original
 *
 * HTML usa <source srcset> en <picture> + __NEXT_DATA__ (Next.js).
 * Fotocasa es generalmente limpio (sin watermarks fuertes).
 *
 * @param {string} html - HTML de la página de Fotocasa
 * @param {string} baseUrl - URL base para resolver relativas
 * @returns {string[]} Array de URLs de fotos (absolutas)
 */
export function extractPhotosFromFotocasa(html, baseUrl) {
  if (!html || typeof html !== 'string') return []

  const photos = new Set()

  // Fotocasa hosts a buscar
  const fotocasaHosts = [
    'static.fotocasa.es',
    'image.fotocasa.es',
    'images.fotocasa.es',
    'cdn.fotocasa.es',
    'media.fotocasa.es',
    'ixpimg.com' // CDN usado por Fotocasa para nuevas imágenes
  ]

  // Método 1: Extraer desde __NEXT_DATA__ (Next.js app)
  // Fotocasa es una SPA con Next.js que embebe los datos de la propiedad
  const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/i)
  if (nextDataMatch) {
    try {
      const jsonStr = nextDataMatch[1]
      // No hacer JSON.parse aquí (puede ser muy grande)
      // En su lugar, extraer URLs directamente con regex
      for (const match of jsonStr.matchAll(/["']url["']\s*:\s*["']([^"']+\.(?:jpe?g|png|webp)[^"']*)/gi)) {
        const url = match[1]
        if (fotocasaHosts.some(host => url.includes(host))) {
          photos.add(url)
        }
      }
    } catch {
      // Ignorar errores de parsing
    }
  }

  // Método 2: Extraer desde <picture><source srcset>
  const pictureMatches = html.match(/<picture[^>]*>[\s\S]*?<\/picture>/gi)
  if (pictureMatches && pictureMatches.length > 0) {
    for (const picture of pictureMatches) {
      for (const match of picture.matchAll(/srcset="([^"]+)"/gi)) {
        const srcset = match[1]
        for (const entry of srcset.split(',')) {
          let url = entry.split(/\s+/)[0].trim()
          if (url && /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url)) {
            url = resolveUrl(url, baseUrl)
            if (url && fotocasaHosts.some(host => url.includes(host))) {
              photos.add(url)
            }
          }
        }
      }
    }
  }

  // Método 3: Buscar en JSON-LD Schema.org (RealEstateListing)
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([^<]+)<\/script>/i)
  if (jsonLdMatch) {
    try {
      const jsonStr = jsonLdMatch[1]
      for (const match of jsonStr.matchAll(/["']image["']\s*:\s*["']([^"']+\.(?:jpe?g|png|webp)[^"']*)/gi)) {
        const url = match[1]
        if (fotocasaHosts.some(host => url.includes(host))) {
          photos.add(url)
        }
      }
    } catch {
      // Ignorar errores
    }
  }

  // Método 4: Buscar URLs de Fotocasa directamente en el HTML (por si acaso)
  for (const match of html.matchAll(/https?:\/\/(?:static|image|images|cdn|media)\.fotocasa\.es[^\s"'<>]+\.(?:jpe?g|png|webp)/gi)) {
    const url = match[0]
    if (url) photos.add(url)
  }

  // Método 5: Buscar URLs en ixpimg (CDN actual)
  for (const match of html.matchAll(/https?:\/\/[^\/]*ixpimg\.com[^\s"'<>]+\.(?:jpe?g|png|webp)/gi)) {
    const url = match[0]
    if (url) photos.add(url)
  }

  // Fallback: buscar en <img data-src> si no tenemos nada
  if (photos.size === 0) {
    const allUrls = extractImageUrlsFromHtml(html)
    for (const rawUrl of allUrls) {
      let url = resolveUrl(rawUrl, baseUrl)
      if (url && fotocasaHosts.some(host => url.includes(host))) {
        photos.add(url)
      }
    }
  }

  // Normalización: remover variantes de tamaño para deduplicar
  // Ejemplo: ?rule=web_412x257 → ?rule=original (o remover el parámetro)
  const result = Array.from(photos).map(url => {
    // Remover query params de tamaño
    let normalized = url.replace(/\?rule=web_\d+x\d+/, '?rule=original')
    normalized = normalized.replace(/\/\d+x\d+\//, '/original/')
    return normalized
  })

  return filterNonPropertyImages(result).slice(0, 40)
}
