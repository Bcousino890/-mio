// ─────────────────────────────────────────────────────────────────────────────
// Watermark removal for real estate portal images.
// Applies platform-specific transformations to get clean (unbranded) photos.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mobilia: Images served from media.mobiliagestion.es with pattern:
 * /Images/{ref}/photo.jpg → /Images/{ref}/photo-original.jpg (removes watermark)
 * Used by: Level Real Estate, Housingo, and other Mobilia-based agencies.
 */
export function isMobiliaImage(url) {
  if (!url || !url.includes('media.mobiliagestion.es')) return false
  if (!url.includes('/Images/')) return false
  if (url.includes('Flags')) return false
  return /\.jpe?g(?:$|[?#])/i.test(url)
}

export function cleanMobiliaImage(url) {
  if (!isMobiliaImage(url)) return url
  // Transform: .jpg → -original.jpg (removes Mobilia watermark)
  return url.replace(/\.jpe?g(?=$|[?#])/i, (match) => {
    const ext = match.toLowerCase()
    return `-original${ext}`
  })
}

/**
 * Inmoweb: Multi-tenant platform serving images from various hosts.
 * Upgrade thumbnails to high-quality versions by removing sizing suffixes.
 * Pattern: photo-thumb.jpg → photo.jpg
 */
const INMOWEB_THUMB_PATTERNS = [
  /\/thumbs\//i,
  /\/thumbnail\//i,
  /\/thumbnails\//i,
  /-thumb(?=\.[a-z]+(?:$|[?#]))/i,
  /-thumbnail(?=\.[a-z]+(?:$|[?#]))/i,
  /[-_]small(?=\.[a-z]+(?:$|[?#]))/i,
  /[-_]sm(?=\.[a-z]+(?:$|[?#]))/i,
  /[-_]mini(?=\.[a-z]+(?:$|[?#]))/i,
]

export function isInmowebImage(url) {
  if (!url) return false
  const propertyPaths = [
    '/images/', '/imagenes/', '/fotos/', '/photos/',
    '/uploads/', '/inmuebles/', '/properties/', '/galeria/', '/gallery/', '/media/'
  ]
  const lower = url.toLowerCase()
  return propertyPaths.some(p => lower.includes(p)) && /\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(url)
}

export function cleanInmowebImage(url) {
  if (!isInmowebImage(url)) return url
  let out = url
  for (const pattern of INMOWEB_THUMB_PATTERNS) {
    if (pattern instanceof RegExp && pattern.test(out)) {
      out = out.replace(pattern, '')
    }
  }
  return out
}

/**
 * Fotocasa: Serves images from various CDNs (now mostly ixpimg.com).
 * Typically clean, but some cached versions may have branding.
 * No aggressive transformation needed; just normalize URLs.
 */
export function isFotocasaImage(url) {
  if (!url) return false
  // Fotocasa is very permissive; just check for valid image extension and property path
  return /\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(url)
}

export function cleanFotocasaImage(url) {
  // Fotocasa images are usually clean. Just return as-is.
  return url
}

/**
 * Habitaclia: Spanish portal with images from multiple sources.
 * Usually served from cdn.habitaclia.com
 * No special transformation; images are generally clean.
 */
export function isHabitacliaImage(url) {
  if (!url) return false
  return /\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(url)
}

export function cleanHabitacliaImage(url) {
  return url
}

/**
 * Agency websites: Hosted on custom domains.
 * Generally no special watermarks, but may have logos. No transformation needed.
 */
export function cleanAgencyWebImage(url) {
  return url
}

/**
 * Main entry point: detects image source and applies appropriate cleaning.
 * Returns the cleaned URL (or original if no cleaning applies).
 */
export function cleanPhotoUrl(url, sourceHint = null) {
  if (!url) return url

  // Try platform-specific cleaners in order of specificity
  if (isMobiliaImage(url)) {
    return cleanMobiliaImage(url)
  }
  if (isInmowebImage(url)) {
    return cleanInmowebImage(url)
  }
  if (sourceHint === 'fotocasa' && isFotocasaImage(url)) {
    return cleanFotocasaImage(url)
  }
  if (sourceHint === 'habitaclia' && isHabitacliaImage(url)) {
    return cleanHabitacliaImage(url)
  }
  if (sourceHint === 'agency' || /^https:\/\/.+\.(es|com|net)/i.test(url)) {
    return cleanAgencyWebImage(url)
  }

  // Default: return as-is if no recognized pattern
  return url
}

/**
 * Batch clean photos from a source, preserving order and deduplicating.
 */
export function cleanPhotos(photos, sourceHint = null) {
  if (!Array.isArray(photos) || photos.length === 0) return []

  const seen = new Set()
  const cleaned = []

  for (const photo of photos) {
    const url = photo?.url || photo
    if (!url || seen.has(url)) continue

    const cleanUrl = cleanPhotoUrl(url, sourceHint)
    if (!seen.has(cleanUrl)) {
      seen.add(cleanUrl)
      cleaned.push(cleanUrl)
    }
  }

  return cleaned
}
