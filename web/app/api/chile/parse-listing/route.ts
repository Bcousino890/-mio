import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Map Portal Inmobiliario slug comunas to SII codes
const SLUG_TO_SII: Record<string, { siiCode: string; label: string }> = {
  vitacura:      { siiCode: '15131', label: 'Vitacura' },
  'las-condes':  { siiCode: '15108', label: 'Las Condes' },
  'lo-barnechea':{ siiCode: '15111', label: 'Lo Barnechea' },
  colina:        { siiCode: '13301', label: 'Colina' },
  providencia:   { siiCode: '13119', label: 'Providencia' },
  nunoa:         { siiCode: '13120', label: 'Ñuñoa' },
  'la-reina':    { siiCode: '13106', label: 'La Reina' },
  santiago:      { siiCode: '13101', label: 'Santiago' },
}

function extractFromSlug(url: string) {
  // e.g. MLC-2009525691-arriendo-casa-6hab-5ba-vitacura-_JM
  const match = url.match(/MLC-\d+-(.+?)(?:_JM|$)/)
  if (!match) return null
  const slug = match[1].toLowerCase()

  const info: Record<string, string | number | null> = { raw_slug: slug }

  // Operation
  if (slug.includes('arriendo')) info.operation = 'rent'
  else if (slug.includes('venta')) info.operation = 'sale'
  else info.operation = null

  // Property type
  if (slug.includes('-casa')) info.property_type = 'casa'
  else if (slug.includes('-departamento') || slug.includes('-depto') || slug.includes('-dpto')) info.property_type = 'departamento'
  else if (slug.includes('-oficina')) info.property_type = 'oficina'
  else if (slug.includes('-terreno')) info.property_type = 'terreno'
  else info.property_type = null

  // Bedrooms
  const habMatch = slug.match(/(\d+)hab/)
  info.bedrooms = habMatch ? parseInt(habMatch[1]) : null

  // Bathrooms
  const baMatch = slug.match(/(\d+)ba/)
  info.bathrooms = baMatch ? parseInt(baMatch[1]) : null

  // Comuna from slug - check known comunas
  info.comuna_slug = null
  info.sii_code = null
  info.comuna_label = null
  for (const [key, val] of Object.entries(SLUG_TO_SII)) {
    if (slug.includes(key)) {
      info.comuna_slug = key
      info.sii_code = val.siiCode
      info.comuna_label = val.label
      break
    }
  }

  return info
}

async function fetchListingPage(url: string): Promise<string> {
  const cleanUrl = url.split('#')[0].split('?')[0]
  const res = await fetch(cleanUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; casafari-mio/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-CL,es;q=0.9',
    },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function extractFromHtml(html: string) {
  const data: Record<string, any> = {}

  // Title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/)
  if (titleMatch) data.title = titleMatch[1].trim()

  // Price — look for JSON-LD or meta
  const priceMatch = html.match(/"price"\s*:\s*"?([\d,.]+)"?/) ||
    html.match(/\$\s*([\d.,]+)\s*(?:UF|CLP|USD)/i)
  if (priceMatch) data.price_raw = priceMatch[1]

  // Currency
  if (html.includes('UF')) data.currency = 'UF'
  else if (html.includes('USD')) data.currency = 'USD'
  else data.currency = 'CLP'

  // Surface area
  const sqmMatch = html.match(/(\d+)\s*m²/) || html.match(/(\d+)\s*metros/)
  if (sqmMatch) data.sqm = parseInt(sqmMatch[1])

  // Address from meta og or schema
  const addressMatch = html.match(/"streetAddress"\s*:\s*"([^"]+)"/) ||
    html.match(/og:street-address[^>]+content="([^"]+)"/)
  if (addressMatch) data.address = addressMatch[1]

  // Lat/lng from JSON-LD or script
  const latMatch = html.match(/"latitude"\s*:\s*(-?\d+\.?\d*)/)
  const lngMatch = html.match(/"longitude"\s*:\s*(-?\d+\.?\d*)/)
  if (latMatch && lngMatch) {
    data.lat = parseFloat(latMatch[1])
    data.lng = parseFloat(lngMatch[1])
  }

  // Rooms from JSON-LD
  const roomsMatch = html.match(/"numberOfRooms"\s*:\s*(\d+)/)
  if (roomsMatch) data.rooms = parseInt(roomsMatch[1])

  // Floors / pisos
  const pisosMatch = html.match(/(\d+)\s*(?:pisos?|piso)\b/i)
  if (pisosMatch) data.floors = parseInt(pisosMatch[1])

  return data
}

async function findSiiCandidates(siiCode: string, address?: string, sqm?: number) {
  if (!siiCode) return []

  try {
    let query = `SELECT rol, direccion, avaluo_fiscal_total, superficie_terreno_m2,
                        codigo_destino_principal, rol_padre
                 FROM sii_roles_cl
                 WHERE sii_comuna_code = $1`
    const params: any[] = [siiCode]

    if (address) {
      params.push(`%${address.toUpperCase()}%`)
      query += ` AND direccion ILIKE $${params.length}`
    }
    if (sqm) {
      params.push(sqm * 0.5, sqm * 2)
      query += ` AND superficie_terreno_m2 BETWEEN $${params.length - 1} AND $${params.length}`
    }

    query += ` ORDER BY avaluo_fiscal_total DESC NULLS LAST LIMIT 10`

    const res = await pool.query(query, params)
    return res.rows
  } catch {
    return []
  }
}

/**
 * POST /api/chile/parse-listing
 * body: { url: string }
 *
 * Fetches a Portal Inmobiliario listing URL, extracts property data,
 * and cross-references with sii_roles_cl to find cadastre candidates.
 */
export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json()
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ success: false, error: 'URL requerida' }, { status: 400 })
    }

    // 1. Extract info from URL slug
    const slugInfo = extractFromSlug(url)

    // 2. Try to fetch the listing page
    let htmlInfo: Record<string, any> = {}
    let fetchError: string | null = null
    try {
      const html = await fetchListingPage(url)
      htmlInfo = extractFromHtml(html)
    } catch (e) {
      fetchError = e instanceof Error ? e.message : 'Error fetching URL'
    }

    // 3. Merge info
    const merged: Record<string, any> = {
      ...slugInfo,
      ...htmlInfo,
      fetch_error: fetchError,
    }

    // 4. Find SII candidates
    const siiCode = (slugInfo?.sii_code as string) || null
    const candidates = siiCode
      ? await findSiiCandidates(siiCode, merged.address, merged.sqm)
      : []

    return NextResponse.json({
      success: true,
      url: url.split('#')[0].split('?')[0],
      extracted: merged,
      sii_candidates: candidates,
      sii_code: siiCode,
      comuna_label: slugInfo?.comuna_label ?? null,
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}
