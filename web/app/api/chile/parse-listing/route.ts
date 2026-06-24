import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'
import { parsePortalListingDetail } from '@/lib/parse-portalinmobiliario-cl'
import { scoreCandidates, type SiiCandidateRow } from '@/lib/sii-match-cl'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Map Portal Inmobiliario slug/comuna name to SII codes
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

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function normalizeToSlug(s: string): string {
  return stripAccents(s).toLowerCase().trim().replace(/\s+/g, '-')
}

function resolveComuna(name: string | null | undefined): { siiCode: string; label: string; slug: string } | null {
  if (!name) return null
  const slug = normalizeToSlug(name)
  for (const [key, val] of Object.entries(SLUG_TO_SII)) {
    if (slug.includes(key) || key.includes(slug)) {
      return { ...val, slug: key }
    }
  }
  return null
}

function extractFromSlug(url: string) {
  // e.g. MLC-2009525691-arriendo-casa-6hab-5ba-vitacura-_JM
  const match = url.match(/MLC-\d+-(.+?)(?:_JM|$)/)
  if (!match) return null
  const slug = match[1].toLowerCase()

  const info: Record<string, string | number | null> = { raw_slug: slug }

  if (slug.includes('arriendo')) info.operation = 'rent'
  else if (slug.includes('venta')) info.operation = 'sale'
  else info.operation = null

  if (slug.includes('-casa')) info.property_type = 'casa'
  else if (slug.includes('-departamento') || slug.includes('-depto') || slug.includes('-dpto')) info.property_type = 'departamento'
  else if (slug.includes('-oficina')) info.property_type = 'oficina'
  else if (slug.includes('-terreno')) info.property_type = 'terreno'
  else info.property_type = null

  const habMatch = slug.match(/(\d+)hab/)
  info.bedrooms = habMatch ? parseInt(habMatch[1]) : null

  const baMatch = slug.match(/(\d+)ba/)
  info.bathrooms = baMatch ? parseInt(baMatch[1]) : null

  const comuna = resolveComuna(slug)
  info.comuna_slug = comuna?.slug ?? null
  info.sii_code = comuna?.siiCode ?? null
  info.comuna_label = comuna?.label ?? null

  return info
}

async function fetchListingPage(url: string): Promise<string> {
  const cleanUrl = url.split('#')[0].split('?')[0]
  const res = await fetch(cleanUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
    },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function findSiiCandidates(siiCode: string, opts: {
  address?: string | null
  sqm?: number | null
  lat?: number | null
  lng?: number | null
}) {
  if (!siiCode) return []

  try {
    const hasGeo = opts.lat != null && opts.lng != null

    const query = `
      SELECT
        rol, direccion, avaluo_fiscal_total, superficie_terreno_m2,
        codigo_destino_principal, rol_padre, lat, lng,
        CASE WHEN $4::double precision IS NOT NULL AND lat IS NOT NULL AND lng IS NOT NULL
             THEN ST_DistanceSphere(geom, ST_SetSRID(ST_MakePoint($4, $3), 4326))
             ELSE NULL END AS distance_m,
        CASE WHEN $2::text IS NOT NULL AND direccion IS NOT NULL
             THEN similarity(unaccent_immutable(upper(direccion)), unaccent_immutable(upper($2)))
             ELSE NULL END AS text_sim
      FROM sii_roles_cl
      WHERE sii_comuna_code = $1
        AND (
          ($2::text IS NOT NULL AND direccion IS NOT NULL
            AND similarity(unaccent_immutable(upper(direccion)), unaccent_immutable(upper($2))) > 0.2)
          OR ($4::double precision IS NOT NULL AND lat IS NOT NULL AND lng IS NOT NULL
            AND ST_DistanceSphere(geom, ST_SetSRID(ST_MakePoint($4, $3), 4326)) < 400)
          OR ($2::text IS NULL AND $4::double precision IS NULL)
        )
      ORDER BY
        CASE WHEN $4::double precision IS NOT NULL AND lat IS NOT NULL AND lng IS NOT NULL
             THEN ST_DistanceSphere(geom, ST_SetSRID(ST_MakePoint($4, $3), 4326)) ELSE 1e9 END ASC,
        avaluo_fiscal_total DESC NULLS LAST
      LIMIT 40
    `
    const params = [siiCode, opts.address ?? null, opts.lat ?? null, opts.lng ?? null]

    const res = await pool.query(query, params)
    return scoreCandidates(res.rows as SiiCandidateRow[], opts.sqm ?? null).slice(0, 12)
  } catch {
    // Si PostGIS/pg_trgm fallan (ej. comuna sin lat/lng poblado), degradar a
    // un filtro simple por dirección/m² en vez de devolver error al usuario.
    try {
      let query = `SELECT rol, direccion, avaluo_fiscal_total, superficie_terreno_m2,
                          codigo_destino_principal, rol_padre, lat, lng,
                          NULL::double precision AS distance_m, NULL::double precision AS text_sim
                   FROM sii_roles_cl
                   WHERE sii_comuna_code = $1`
      const params: unknown[] = [siiCode]
      if (opts.address) {
        params.push(`%${opts.address.toUpperCase()}%`)
        query += ` AND direccion ILIKE $${params.length}`
      }
      if (opts.sqm) {
        params.push(opts.sqm * 0.5, opts.sqm * 2)
        query += ` AND superficie_terreno_m2 BETWEEN $${params.length - 1} AND $${params.length}`
      }
      query += ` ORDER BY avaluo_fiscal_total DESC NULLS LAST LIMIT 12`
      const res = await pool.query(query, params)
      return scoreCandidates(res.rows as SiiCandidateRow[], opts.sqm ?? null)
    } catch {
      return []
    }
  }
}

/**
 * POST /api/chile/parse-listing
 * body: { url: string }
 *
 * Fetches a Portal Inmobiliario listing URL, extracts property data,
 * and cross-references with sii_roles_cl to find cadastre candidates,
 * ranked by a distance/superficie/dirección match score (0..100).
 */
export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json()
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ success: false, error: 'URL requerida' }, { status: 400 })
    }

    // 1. Extract info from URL slug (fallback if the page fetch/parse fails)
    const slugInfo = extractFromSlug(url)

    // 2. Fetch + parse the listing page (Nordic blob — see lib/parse-portalinmobiliario-cl.ts)
    let parsed: Record<string, unknown> = {}
    let fetchError: string | null = null
    try {
      const html = await fetchListingPage(url)
      const detail = parsePortalListingDetail(html)
      if (detail) {
        parsed = {
          title: detail.title,
          operation: detail.operation,
          property_type: detail.property_type,
          price_raw: detail.price,
          currency: detail.currency,
          sqm: detail.square_meters,
          bedrooms: detail.bedrooms,
          bathrooms: detail.bathrooms,
          lat: detail.latitude,
          lng: detail.longitude,
          address: detail.address,
          address_full: detail.address && detail.comuna ? `${detail.address}, ${detail.comuna}` : detail.address,
          advertiser_name: detail.advertiser_name,
          advertiser_type: detail.advertiser_type,
          photos: detail.photos,
          description: detail.description,
          comuna_detected: detail.comuna,
        }
      } else {
        fetchError = 'No se pudo interpretar el contenido del anuncio'
      }
    } catch (e) {
      fetchError = e instanceof Error ? e.message : 'Error fetching URL'
    }

    // 3. Resolve comuna: prefer the one detected in the page itself
    const comunaMatch = resolveComuna((parsed.comuna_detected as string) ?? null) ?? (slugInfo
      ? { siiCode: slugInfo.sii_code as string, label: slugInfo.comuna_label as string, slug: slugInfo.comuna_slug as string }
      : null)

    // 4. Merge info (page data wins over slug-derived guesses where present)
    const merged: Record<string, unknown> = {
      ...slugInfo,
      ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== null && v !== undefined)),
      sii_code: comunaMatch?.siiCode ?? null,
      comuna_slug: comunaMatch?.slug ?? null,
      comuna_label: comunaMatch?.label ?? null,
      fetch_error: fetchError,
    }

    // 5. Find SII candidates, scored by distance + superficie + similitud de dirección
    const siiCode = (merged.sii_code as string) || null
    const candidates = siiCode
      ? await findSiiCandidates(siiCode, {
          address: (merged.address as string) ?? null,
          sqm: (merged.sqm as number) ?? null,
          lat: (merged.lat as number) ?? null,
          lng: (merged.lng as number) ?? null,
        })
      : []

    return NextResponse.json({
      success: true,
      url: url.split('#')[0].split('?')[0],
      extracted: merged,
      sii_candidates: candidates,
      sii_code: siiCode,
      comuna_label: comunaMatch?.label ?? null,
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}
