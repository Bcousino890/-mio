#!/usr/bin/env node
// Extractores de fotos específicos para cada plataforma CRM
// Detecta el CRM (Mobilia, Inmoweb, Level, etc.) y usa el extractor correspondiente

import { load } from 'cheerio'

const MOBILIA_HOST = 'media.mobiliagestion.es'

function isMobiliaImageUrl(url) {
  if (!url) return false
  if (!url.includes(MOBILIA_HOST)) return false
  if (!url.includes('/Images/')) return false
  if (url.includes('Flags')) return false
  return /\.jpg(?:$|[?#])/i.test(url)
}

function toMobiliaOriginal(url) {
  if (/-original\.jpg(?:$|[?#])/i.test(url)) return url
  return url.replace(/\.jpg(?=$|[?#])/i, '-original.jpg')
}

export async function extractPhotosFromCRM(crm, html, agencyDomain, referenceId) {
  const crm_upper = (crm || '').toUpperCase()

  if (crm_upper.includes('MOBILIA') || crm_upper.includes('LEVEL')) {
    return extractPhotosFromMobilia(html, referenceId)
  } else if (crm_upper.includes('INMOWEB')) {
    return extractPhotosFromInmoweb(html, referenceId)
  } else if (crm_upper.includes('FOTOCASA')) {
    return extractPhotosFromFotocasa(html, referenceId)
  } else if (crm_upper.includes('VIVANUNCIOS')) {
    return extractPhotosFromVivanuncios(html, referenceId)
  }

  return []
}

export function extractPhotosFromMobilia(html, referenceId) {
  try {
    const $ = load(html)
    const seen = new Set()
    const photos = []
    const pathFilter = referenceId ? `/Images/${referenceId}/` : null

    $('img').each((_, el) => {
      const $el = $(el)
      const dataOriginal = $el.attr('data-original')
      const dataSrc = $el.attr('data-src')
      const src = $el.attr('src')
      const srcset = $el.attr('srcset')
      const firstSrcset = srcset
        ? srcset.split(',')[0]?.trim().split(/\s+/)[0]
        : undefined

      const ordered = [dataOriginal, dataSrc, src, firstSrcset]
      let chosen = undefined
      for (const candidate of ordered) {
        if (candidate && isMobiliaImageUrl(candidate)) {
          if (pathFilter && !candidate.includes(pathFilter)) continue
          chosen = candidate
          break
        }
      }

      if (!chosen) return

      const normalized = toMobiliaOriginal(chosen)
      if (seen.has(normalized)) return
      seen.add(normalized)
      photos.push(normalized)
    })

    return photos
  } catch (e) {
    console.error(`Error extrayendo fotos de Mobilia: ${e.message}`)
    return []
  }
}

export function extractPhotosFromInmoweb(html, referenceId) {
  try {
    const $ = load(html)
    const photos = []

    // Inmoweb típicamente usa <img> con src apuntando a su CDN
    // Patrón: https://inmobiliaria.inmoweb.es/images/...
    $('img').each((_, el) => {
      const src = $(el).attr('src')
      if (src && (src.includes('inmoweb') || src.includes('/images/'))) {
        // Normalizar: inmoweb sirve versiones sin thumbnail
        const normalized = src.replace(/-thumb\.jpg/i, '.jpg')
        if (!photos.includes(normalized)) {
          photos.push(normalized)
        }
      }
    })

    return photos
  } catch (e) {
    console.error(`Error extrayendo fotos de Inmoweb: ${e.message}`)
    return []
  }
}

export function extractPhotosFromFotocasa(html, referenceId) {
  try {
    const $ = load(html)
    const photos = []

    // Fotocasa usa múltiples formatos. Buscar en picture/source y img
    $('img').each((_, el) => {
      const src = $(el).attr('src')
      const dataSrc = $(el).attr('data-src')
      const url = dataSrc || src

      if (url && url.includes('fotocasa')) {
        if (!photos.includes(url)) {
          photos.push(url)
        }
      }
    })

    // También buscar en <picture><source>
    $('picture source').each((_, el) => {
      const srcset = $(el).attr('srcset')
      if (srcset) {
        const url = srcset.split(',')[0]?.trim().split(/\s+/)[0]
        if (url && url.includes('fotocasa') && !photos.includes(url)) {
          photos.push(url)
        }
      }
    })

    return photos
  } catch (e) {
    console.error(`Error extrayendo fotos de Fotocasa: ${e.message}`)
    return []
  }
}

export function extractPhotosFromVivanuncios(html, referenceId) {
  try {
    const $ = load(html)
    const photos = []

    $('img').each((_, el) => {
      const src = $(el).attr('src')
      const dataSrc = $(el).attr('data-src')
      const url = dataSrc || src

      if (url && url.includes('vivanuncios')) {
        if (!photos.includes(url)) {
          photos.push(url)
        }
      }
    })

    return photos
  } catch (e) {
    console.error(`Error extrayendo fotos de Vivanuncios: ${e.message}`)
    return []
  }
}
