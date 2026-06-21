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

function tryParseJson(s: string): any {
  try { return JSON.parse(s) } catch { return null }
}

// Portal Inmobiliario embeds the full listing as window.__PRELOADED_STATE__ or
// similar. Walk the parsed JSON looking for known attribute structures.
function extractInitialState(html: string): Record<string, any> | null {
  // Patterns used by Portal Inmobiliario
  const patterns = [
    /window\.__PRELOADED_STATE__\s*=\s*({.+?})(?=;<\/script>|;\s*window\.)/s,
    /window\.MeliGA\s*=\s*({.+?})(?=;<\/script>)/s,
    /"initialState"\s*:\s*({.+?})(?=};<\/script>)/s,
  ]
  for (const pat of patterns) {
    const m = html.match(pat)
    if (m) {
      const parsed = tryParseJson(m[1])
      if (parsed) return parsed
    }
  }
  return null
}

// Recursively find all attribute arrays or specific key paths in a large JSON tree
function deepGet(obj: any, keys: string[]): any {
  if (!obj || typeof obj !== 'object') return undefined
  for (const k of keys) {
    if (k in obj) return obj[k]
  }
  for (const v of Object.values(obj)) {
    const found = deepGet(v, keys)
    if (found !== undefined) return found
  }
  return undefined
}

function extractFromHtml(html: string) {
  const data: Record<string, any> = {}

  // ── 1. Title ──────────────────────────────────────────────────────────────
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/)
  if (titleMatch) data.title = titleMatch[1].replace(/\s*\|.*/, '').trim()

  // ── 2. Geo: lat/lng from JSON-LD, maps scripts, or og tags ────────────────
  const latMatch = html.match(/"latitude"\s*:\s*(-?\d{1,3}\.\d+)/) ||
    html.match(/lat(?:itude)?\s*[:=]\s*["']?(-?\d{1,3}\.\d+)/)
  const lngMatch = html.match(/"longitude"\s*:\s*(-?\d{1,3}\.\d+)/) ||
    html.match(/l(?:ng|on)(?:gitude)?\s*[:=]\s*["']?(-?\d{1,3}\.\d+)/)
  if (latMatch) data.lat = parseFloat(latMatch[1])
  if (lngMatch) data.lng = parseFloat(lngMatch[1])

  // Also look for pin position in maps embed URLs
  if (!data.lat) {
    const pinMatch = html.match(/[?&](?:center|q)=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)
    if (pinMatch) { data.lat = parseFloat(pinMatch[1]); data.lng = parseFloat(pinMatch[2]) }
  }

  // ── 3. Address ────────────────────────────────────────────────────────────
  const addrMatch = html.match(/"streetAddress"\s*:\s*"([^"]+)"/) ||
    html.match(/og:street-address[^>]+content="([^"]+)"/) ||
    html.match(/class="[^"]*address[^"]*"[^>]*>([^<]{5,100})</)
  if (addrMatch) data.address = addrMatch[1].trim()

  // Full address from JSON-LD
  const fullAddrMatch = html.match(/"address"\s*:\s*\{[^}]*"addressLocality"\s*:\s*"([^"]+)"[^}]*"streetAddress"\s*:\s*"([^"]+)"/)
  if (fullAddrMatch) data.address_full = `${fullAddrMatch[2]}, ${fullAddrMatch[1]}`

  // ── 4. Price ──────────────────────────────────────────────────────────────
  const priceJsonMatch = html.match(/"price"\s*:\s*\{[^}]*"value"\s*:\s*([\d.]+)[^}]*"currency_id"\s*:\s*"([^"]+)"/)
  if (priceJsonMatch) {
    data.price_raw = priceJsonMatch[1]
    data.currency = priceJsonMatch[2]
  } else {
    const priceMatch = html.match(/"price"\s*:\s*"?([\d,.]+)"?/)
    if (priceMatch) data.price_raw = priceMatch[1]
    if (html.match(/["']currency_id["']\s*:\s*["']UF["']/)) data.currency = 'UF'
    else if (html.match(/["']currency_id["']\s*:\s*["']USD["']/)) data.currency = 'USD'
    else if (html.match(/["']currency_id["']\s*:\s*["']CLP["']/)) data.currency = 'CLP'
  }

  // ── 5. Core attributes via JSON-LD schema or attribute arrays ─────────────
  // JSON-LD floorSize / numberOfRooms
  const floorSizeMatch = html.match(/"floorSize"\s*:\s*\{[^}]*"value"\s*:\s*([\d.]+)/)
  if (floorSizeMatch) data.sqm = parseFloat(floorSizeMatch[1])
  const roomsMatch = html.match(/"numberOfRooms"\s*:\s*(\d+)/)
  if (roomsMatch) data.bedrooms_jsonld = parseInt(roomsMatch[1])

  // Try to extract the "attributes" array from Portal Inmobiliario's page JSON
  // It looks like: {"id":"BEDROOMS","value_name":"6"} or {"id":"TOTAL_AREA","value_name":"450"}
  const attrSections = [...html.matchAll(/"id"\s*:\s*"([A-Z_]+)"\s*,\s*"(?:name|value_name)"\s*:\s*"([^"]+)"/g)]
  const attrs: Record<string, string> = {}
  for (const m of attrSections) {
    attrs[m[1]] = m[2]
  }

  // Also capture pattern: {"id":"BEDROOMS","value_name":"6"}
  const attrFull = [...html.matchAll(/"id"\s*:\s*"([A-Z_]+)"[^}]*?"value_name"\s*:\s*"([^"]+)"/g)]
  for (const m of attrFull) {
    if (!attrs[m[1]]) attrs[m[1]] = m[2]
  }

  if (Object.keys(attrs).length > 0) {
    data.attributes_raw = attrs

    const n = (k: string) => { const v = attrs[k]; return v ? parseFloat(v) || v : null }
    const s = (k: string) => attrs[k] ?? null

    data.sqm              = data.sqm ?? n('TOTAL_AREA') ?? n('SURFACE_COVERED')
    data.sqm_util         = n('COVERED_AREA') ?? n('SURFACE_TOTAL')
    data.bedrooms         = n('BEDROOMS') ?? data.bedrooms_jsonld ?? null
    data.bathrooms        = n('FULL_BATHROOMS') ?? n('BATHROOMS') ?? null
    data.parking          = n('PARKING_LOTS')
    data.floors           = n('FLOORS')
    data.antiquity        = s('PROPERTY_AGE')
    data.property_type_detail = s('PROPERTY_TYPE') ?? s('SUBTYPE')
    data.orientation      = s('ORIENTATION')
    data.furnished        = s('FURNISHED')
    data.storage          = n('STORAGE_ROOMS')
    data.allows_pets      = s('PETS_ALLOWED')
    data.common_expenses  = s('MAINTENANCE_FEE')

    // Amenities / boolean features
    const amenityKeys: Record<string, string> = {
      PARRILLA: 'parrilla', ALARM: 'alarma', CONCIERGE: 'conserjeria',
      HEATING: 'calefaccion', AIR_CONDITIONER: 'aire_acondicionado',
      CABLE_TV: 'tv_cable', PHONE: 'linea_telefonica',
      NATURAL_GAS: 'gas_natural', WASHING_MACHINE_CONNECTION: 'conexion_lavarropas',
      SATELLITE_TV: 'tv_satelital', RUNNING_WATER: 'agua_corriente',
      BOILER: 'caldera', POOL: 'piscina', GYM: 'gimnasio',
      ELEVATOR: 'ascensor', LAUNDRY: 'lavanderia', TERRACE: 'terraza',
    }
    const amenities: Record<string, string> = {}
    for (const [attrId, label] of Object.entries(amenityKeys)) {
      if (attrs[attrId] !== undefined) amenities[label] = attrs[attrId]
    }
    if (Object.keys(amenities).length > 0) data.amenities = amenities
  } else {
    // Fallback plain-text regexes
    const sqmMatch = html.match(/Superficie\s+total[^<]*?(\d+)\s*m²/i) ||
      html.match(/(\d+)\s*m²/)
    if (sqmMatch) data.sqm = parseInt(sqmMatch[1])

    const dormMatch = html.match(/Dormitorios[^<]*?(\d+)/i)
    if (dormMatch) data.bedrooms = parseInt(dormMatch[1])

    const bathMatch = html.match(/Ba[ñn]os[^<]*?(\d+)/i)
    if (bathMatch) data.bathrooms = parseInt(bathMatch[1])
  }

  // Remove nulls to keep response lean
  for (const k of Object.keys(data)) {
    if (data[k] === null || data[k] === undefined) delete data[k]
  }

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
