// ─────────────────────────────────────────────────────────────────────────────
// crm-photo-extractor.mjs
//
// Extrae fotos de las webs de CRM de agencias (Mobilia, Inmoweb, Level, etc.)
// a partir del HTML de la ficha de anuncio en el CRM.
//
// Uso:
//   const photos = await extractPhotosFromCRM('MOBILIA', html, 'housingo.es', '1338678')
//   // => ['https://...jpg', 'https://...jpg', ...]
//
// Características:
// - Patrones específicos por CRM (Mobilia: thumbnail → original, etc.)
// - Fallback graceful: devuelve array vacío si falla
// - Valida URLs (no nulas, bien formadas)
// - Deduplica automáticamente
// - Respeta límite de 40 fotos
// ─────────────────────────────────────────────────────────────────────────────

import { cleanPhotos } from './watermark-removal.mjs'

/**
 * Extrae fotos de una ficha de Mobilia.
 * Patrón: <img src="...thumbnail..." → ...original... data-original="...jpg"
 *
 * @param {string} html - HTML de la ficha de Mobilia
 * @param {string} agencyDomain - Dominio de la agencia (p.ej. "housingo.es")
 * @returns {string[]} Array de URLs de fotos
 */
function extractPhotosFromMobilia(html, agencyDomain) {
  if (!html) return []
  const seen = new Set()
  const photos = []

  // Patrón 1: data-original en img tags
  for (const m of html.matchAll(/data-original="([^"]+\.jpg)"/gi)) {
    const url = m[1]
    if (!seen.has(url) && isValidPhotoUrl(url)) {
      seen.add(url)
      photos.push(url)
    }
  }

  // Patrón 2: src directo si data-original no existe (fallback)
  if (photos.length === 0) {
    for (const m of html.matchAll(/class="[^"]*(?:property|listing|inmueble)[^"]*"[\s\S]*?<img[^>]+src="([^"]+\.jpg)"/gi)) {
      const url = m[1]
      if (!seen.has(url) && isValidPhotoUrl(url)) {
        seen.add(url)
        photos.push(url)
      }
    }
  }

  // Patrón 3: URLs en atributos data-* o data-gallery
  for (const m of html.matchAll(/data-(?:gallery|image|photo|src)="([^"]+\.jpg)"/gi)) {
    const url = m[1]
    if (!seen.has(url) && isValidPhotoUrl(url)) {
      seen.add(url)
      photos.push(url)
    }
  }

  return photos.slice(0, 40)
}

/**
 * Extrae fotos de una ficha de Inmoweb.
 * Patrón: URLs en slides/carousel, típicamente con estructura /img/ o /pictures/
 *
 * @param {string} html - HTML de la ficha
 * @returns {string[]} Array de URLs
 */
function extractPhotosFromInmoweb(html) {
  if (!html) return []
  const seen = new Set()
  const photos = []

  // Patrón 1: src en img tags dentro de gallery/carousel/slider
  for (const m of html.matchAll(/(?:gallery|carousel|slider|slide)[^>]*>[\s\S]*?<img[^>]+src="([^"]+\.jpg)"/gi)) {
    const url = m[1]
    if (!seen.has(url) && isValidPhotoUrl(url)) {
      seen.add(url)
      photos.push(url)
    }
  }

  // Patrón 2: URLs en atributos data-* de elementos de galería
  for (const m of html.matchAll(/data-(?:src|image)="([^"]+\.jpg)"/gi)) {
    const url = m[1]
    if (!seen.has(url) && isValidPhotoUrl(url)) {
      seen.add(url)
      photos.push(url)
    }
  }

  // Patrón 3: URLs en arrays JS (típico de Single Page Apps)
  // Busca algo como: imageUrls: ["https://..jpg", ...]
  for (const m of html.matchAll(/(?:imageUrls|photoUrls|photos|images|gallery)[\s:]*\[\s*"([^"]+\.jpg)"/gi)) {
    const url = m[1]
    if (!seen.has(url) && isValidPhotoUrl(url)) {
      seen.add(url)
      photos.push(url)
    }
  }

  return photos.slice(0, 40)
}

/**
 * Extrae fotos de una ficha de Level (CRM moderno, típicamente más limpio).
 * Patrón: URLs en data-* o componentes React renderizadas
 *
 * @param {string} html - HTML de la ficha
 * @returns {string[]} Array de URLs
 */
function extractPhotosFromLevel(html) {
  if (!html) return []
  const seen = new Set()
  const photos = []

  // Patrón 1: data-* atributos (Level suele usar data-image-src, etc.)
  for (const m of html.matchAll(/data-image(?:-src|url)="([^"]+\.jpg)"/gi)) {
    const url = m[1]
    if (!seen.has(url) && isValidPhotoUrl(url)) {
      seen.add(url)
      photos.push(url)
    }
  }

  // Patrón 2: img src en galerías
  for (const m of html.matchAll(/class="[^"]*(?:image-container|photo-slide|gallery-item)[^"]*"[\s\S]*?<img[^>]+src="([^"]+\.jpg)"/gi)) {
    const url = m[1]
    if (!seen.has(url) && isValidPhotoUrl(url)) {
      seen.add(url)
      photos.push(url)
    }
  }

  // Patrón 3: Arrays JS de imágenes
  for (const m of html.matchAll(/images?[\s:]*\[\s*"([^"]+\.jpg)"/gi)) {
    const url = m[1]
    if (!seen.has(url) && isValidPhotoUrl(url)) {
      seen.add(url)
      photos.push(url)
    }
  }

  return photos.slice(0, 40)
}

/**
 * Extrae fotos de Fotocasa (típicamente /casa/[ID]/).
 * Estructura: img tags en carousel con src directo
 *
 * @param {string} html - HTML de la ficha
 * @returns {string[]} Array de URLs
 */
function extractPhotosFromFotocasa(html) {
  if (!html) return []
  const seen = new Set()
  const photos = []

  // Patrón 1: src directo en img tags
  for (const m of html.matchAll(/<img[^>]+src="([^"]+\.(?:jpg|jpeg|png))"[^>]*(?:alt|title)="[^"]*(?:foto|photo|image)[^"]*"/gi)) {
    const url = m[1]
    if (!seen.has(url) && isValidPhotoUrl(url)) {
      seen.add(url)
      photos.push(url)
    }
  }

  // Patrón 2: data-src en lazy loading
  for (const m of html.matchAll(/data-src="([^"]+\.(?:jpg|jpeg|png))"/gi)) {
    const url = m[1]
    if (!seen.has(url) && isValidPhotoUrl(url)) {
      seen.add(url)
      photos.push(url)
    }
  }

  // Patrón 3: URLs en arrays o JSON embebido
  for (const m of html.matchAll(/image[Ss]?[\s:]*\[\s*"([^"]+\.(?:jpg|jpeg|png))"/gi)) {
    const url = m[1]
    if (!seen.has(url) && isValidPhotoUrl(url)) {
      seen.add(url)
      photos.push(url)
    }
  }

  return photos.slice(0, 40)
}

/**
 * Extrae fotos de Vivanuncios.
 * Estructura: carousel/galería típica con img src
 *
 * @param {string} html - HTML de la ficha
 * @returns {string[]} Array de URLs
 */
function extractPhotosFromVivanuncios(html) {
  if (!html) return []
  const seen = new Set()
  const photos = []

  // Patrón 1: img tags con src
  for (const m of html.matchAll(/<img[^>]+src="([^"]+\.(?:jpg|jpeg|png|gif))"[^>]*>/gi)) {
    const url = m[1]
    // Filtrar imágenes de interfaz: logos, iconos, etc. (típicamente muy pequeñas)
    if (!seen.has(url) && isValidPhotoUrl(url) && !isIconUrl(url)) {
      seen.add(url)
      photos.push(url)
    }
  }

  // Patrón 2: data-src lazy loading
  for (const m of html.matchAll(/data-src="([^"]+\.(?:jpg|jpeg|png|gif))"/gi)) {
    const url = m[1]
    if (!seen.has(url) && isValidPhotoUrl(url) && !isIconUrl(url)) {
      seen.add(url)
      photos.push(url)
    }
  }

  return photos.slice(0, 40)
}

/**
 * Valida si una URL parece ser una foto legítima (no broken, bien formada).
 * @param {string} url
 * @returns {boolean}
 */
function isValidPhotoUrl(url) {
  if (!url || typeof url !== 'string') return false
  // Debe ser HTTPS o HTTP y terminar en extensión de imagen
  if (!/^https?:\/\//.test(url)) {
    // Podría ser URL relativa; aceptarla si empieza con / o contiene /
    if (!/^\/|^\.\//.test(url)) return false
  }
  // Extensiones de imagen comunes
  return /\.(?:jpg|jpeg|png|gif|webp)(?:\?|$)/i.test(url)
}

/**
 * Detecta si una URL es probablemente un icono o elemento de UI (muy pequeño).
 * Heurística simple: URL contiene "icon", "logo", "thumb-icon", "badge", etc.
 * @param {string} url
 * @returns {boolean}
 */
function isIconUrl(url) {
  return /(?:icon|logo|badge|bullet|thumb-icon|sprite|flag|favicon)/i.test(url)
}

/**
 * Función principal: detecta el CRM y extrae fotos según el tipo.
 * Manejo de errores graceful: si algo falla, devuelve array vacío (no tira excepción).
 *
 * @param {string} crmName - Nombre del CRM detectado (MOBILIA, INMOWEB, LEVEL, FOTOCASA, VIVANUNCIOS)
 * @param {string} html - HTML de la ficha del anuncio en el CRM
 * @param {string} agencyDomain - Dominio de la agencia (para contexto)
 * @param {string} referenceId - ID del anuncio en el CRM (para contexto/logging)
 * @returns {Promise<string[]>} Array de URLs de fotos (vacío si extracción falla)
 */
export async function extractPhotosFromCRM(crmName, html, agencyDomain, referenceId) {
  try {
    if (!crmName || !html) {
      return []
    }

    let photos = []

    switch (crmName.toUpperCase()) {
      case 'MOBILIA':
        photos = extractPhotosFromMobilia(html, agencyDomain)
        break
      case 'INMOWEB':
        photos = extractPhotosFromInmoweb(html)
        break
      case 'LEVEL':
        photos = extractPhotosFromLevel(html)
        break
      case 'FOTOCASA':
        photos = extractPhotosFromFotocasa(html)
        break
      case 'VIVANUNCIOS':
        photos = extractPhotosFromVivanuncios(html)
        break
      case 'IDEALISTA':
        // Si llegamos a este punto es inusual; Idealista ya trata en parseDetailPage
        photos = extractPhotosFromFotocasa(html) // usar patrón genérico
        break
      default:
        // CRM desconocido: intentar patrón genérico
        photos = extractPhotosFromFotocasa(html)
    }

    // Aplicar limpieza de watermarks específica del CRM
    if (photos.length > 0) {
      photos = cleanPhotos(photos, crmName.toLowerCase())
    }

    return photos.slice(0, 40)
  } catch (e) {
    // Fallback graceful: loguea pero no tira error
    console.error(`[crm-photo-extractor] error extrayendo fotos de ${crmName} (${agencyDomain}/${referenceId}): ${e.message}`)
    return []
  }
}

/**
 * Extrae fotos de Mobilia explícitamente (se exporta para tests/debugging).
 * @export
 */
export { extractPhotosFromMobilia }

/**
 * Extrae fotos de Inmoweb explícitamente.
 * @export
 */
export { extractPhotosFromInmoweb }

/**
 * Extrae fotos de Level explícitamente.
 * @export
 */
export { extractPhotosFromLevel }

/**
 * Extrae fotos de Fotocasa explícitamente.
 * @export
 */
export { extractPhotosFromFotocasa }

/**
 * Extrae fotos de Vivanuncios explícitamente.
 * @export
 */
export { extractPhotosFromVivanuncios }

export default {
  extractPhotosFromCRM,
  extractPhotosFromMobilia,
  extractPhotosFromInmoweb,
  extractPhotosFromLevel,
  extractPhotosFromFotocasa,
  extractPhotosFromVivanuncios,
}
