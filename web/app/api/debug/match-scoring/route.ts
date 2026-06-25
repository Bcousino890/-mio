import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'
import { parsePortalListingDetail } from '@/lib/parse-portalinmobiliario-cl'
import { scoreCandidate, type ParsedListing } from '@/lib/sii-match-cl-v2'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function fetchListingPage(url: string): Promise<string> {
  const cleanUrl = url.split('#')[0].split('?')[0]
  const res = await fetch(cleanUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

export async function POST(request: NextRequest) {
  try {
    const { url, rol_to_check } = await request.json()
    if (!url) {
      return NextResponse.json({ error: 'URL requerida' }, { status: 400 })
    }

    // Fetch + parse listing
    const html = await fetchListingPage(url)
    const detail = parsePortalListingDetail(html)

    if (!detail) {
      return NextResponse.json({ error: 'No se pudo parsear el anuncio' }, { status: 400 })
    }

    const listing: ParsedListing = {
      address: detail.address,
      address_full: detail.address && detail.comuna ? `${detail.address}, ${detail.comuna}` : detail.address,
      lat: detail.latitude,
      lng: detail.longitude,
      sqm: detail.square_meters,
      bedrooms: detail.bedrooms,
      bathrooms: detail.bathrooms,
      property_type: detail.property_type,
    }

    // Buscar candidatos en SII
    const query = `
      SELECT
        rol, direccion, avaluo_fiscal_total, superficie_terreno_m2,
        superficie_construida_m2, codigo_destino_principal, rol_padre, lat, lng,
        ST_DistanceSphere(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_SetSRID(ST_MakePoint($4, $3), 4326)) AS distance_m
      FROM sii_roles_cl
      WHERE sii_comuna_code = '15108'
        AND lat IS NOT NULL AND lng IS NOT NULL
      ORDER BY
        ST_DistanceSphere(ST_SetSRID(ST_MakePoint(lng, lat), 4326), ST_SetSRID(ST_MakePoint($4, $3), 4326)) ASC
      LIMIT 100
    `
    const params = [detail.latitude, detail.longitude]
    const res = await pool.query(query, params)

    // Score cada uno
    const scored = res.rows.map((candidate) => {
      const result = scoreCandidate(listing, candidate)
      return {
        rol: candidate.rol,
        direccion: candidate.direccion,
        distance_m: candidate.distance_m,
        superficie_terreno_m2: candidate.superficie_terreno_m2,
        score: result.score,
        raw_score: result.raw_score,
        confidence_level: result.confidence_level,
        components: result.components,
      }
    })
    .sort((a, b) => b.score - a.score)

    // Buscar el rol específico
    const targetRol = scored.find((s) => s.rol === rol_to_check)

    return NextResponse.json({
      extracted: listing,
      top_10: scored.slice(0, 10),
      target_rol: targetRol,
      total_candidates: scored.length,
    })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}
