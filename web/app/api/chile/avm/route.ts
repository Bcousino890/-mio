import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

/**
 * GET /api/chile/avm?sii_comuna_code=15108&rol=795-198
 *
 * AVM v1 (valoración automática) por comparables de OFERTA.
 *
 * No hay precios de cierre públicos en Chile (el CBR no publica un dataset de
 * ventas — ver docs/SII-ENRICHMENT-ROADMAP.md), así que este AVM estima el
 * valor a partir de los anuncios de venta activos de la zona (`listings_cl`):
 * mediana $/m² construido de los comparables × la superficie construida del
 * predio. Es un "valor de oferta", con sesgo al alza conocido (~5-12% sobre el
 * cierre) que se declara en la UI — nunca se presenta como tasación.
 *
 * Estrategia de comparables: primero un radio de 1 km alrededor del predio
 * (si tiene coordenadas); si no reúne el mínimo, se cae a toda la comuna.
 */

const MIN_COMPS = 5
const RADIUS_M = 1000

interface CompStats {
  n: number
  median_sqm: number | null
  p25_sqm: number | null
  p75_sqm: number | null
}

async function comparables(
  siiComunaCode: string,
  lat: number | null,
  lng: number | null,
  useRadius: boolean
): Promise<CompStats> {
  const params: (string | number)[] = [siiComunaCode]
  let geoCond = ''
  if (useRadius && lat != null && lng != null) {
    params.push(lng, lat, RADIUS_M)
    geoCond = `AND l.geom IS NOT NULL AND ST_DWithin(l.geom::geography, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, $4)`
  }
  const { rows } = await pool.query(
    `WITH comps AS (
       SELECT (l.price::numeric / l.square_meters) AS sqm
       FROM listings_cl l
       JOIN chile_comunas c ON c.id = l.comuna_id
       WHERE c.sii_comuna_code = $1
         AND l.is_active AND l.operation = 'sale'
         AND l.price > 0 AND l.square_meters > 0
         ${geoCond}
     )
     SELECT count(*)::int AS n,
            percentile_cont(0.5)  WITHIN GROUP (ORDER BY sqm) AS median_sqm,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY sqm) AS p25_sqm,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY sqm) AS p75_sqm
     FROM comps`,
    params
  )
  const r = rows[0]
  return {
    n: Number(r?.n ?? 0),
    median_sqm: r?.median_sqm != null ? Number(r.median_sqm) : null,
    p25_sqm: r?.p25_sqm != null ? Number(r.p25_sqm) : null,
    p75_sqm: r?.p75_sqm != null ? Number(r.p75_sqm) : null,
  }
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const siiComunaCode = sp.get('sii_comuna_code')?.trim()
  const rol = sp.get('rol')?.trim()

  if (!siiComunaCode || !rol) {
    return NextResponse.json({ success: false, error: 'sii_comuna_code y rol requeridos' }, { status: 400 })
  }

  try {
    // Predio objetivo: coordenadas y superficie base (construida; si no hay,
    // terreno). LIMIT 1 por si el rol tiene filas duplicadas de reprocesos.
    const { rows } = await pool.query(
      `SELECT lat, lng, superficie_construida_m2, superficie_terreno_m2, codigo_destino_principal
       FROM sii_roles_cl
       WHERE sii_comuna_code = $1 AND rol = $2
       ORDER BY avaluo_fiscal_total DESC NULLS LAST
       LIMIT 1`,
      [siiComunaCode, rol]
    )
    const target = rows[0]
    if (!target) {
      return NextResponse.json({ success: false, error: 'Rol no encontrado' }, { status: 404 })
    }

    const lat = target.lat != null ? Number(target.lat) : null
    const lng = target.lng != null ? Number(target.lng) : null
    const construida = target.superficie_construida_m2 != null ? Number(target.superficie_construida_m2) : null
    const terreno = target.superficie_terreno_m2 != null ? Number(target.superficie_terreno_m2) : null
    const baseSurface = construida && construida > 0 ? construida : terreno && terreno > 0 ? terreno : null
    const baseSurfaceType = construida && construida > 0 ? 'construida' : 'terreno'

    // Comparables: radio primero, comuna como respaldo.
    let stats = await comparables(siiComunaCode, lat, lng, true)
    let scope: 'radio' | 'comuna' = 'radio'
    if (stats.n < MIN_COMPS) {
      const comunaStats = await comparables(siiComunaCode, lat, lng, false)
      if (comunaStats.n > stats.n) { stats = comunaStats; scope = 'comuna' }
    }

    const enough = stats.n >= MIN_COMPS && stats.median_sqm != null
    const estimated = enough && baseSurface ? Math.round(stats.median_sqm! * baseSurface) : null
    const estimatedMin = enough && baseSurface && stats.p25_sqm != null ? Math.round(stats.p25_sqm * baseSurface) : null
    const estimatedMax = enough && baseSurface && stats.p75_sqm != null ? Math.round(stats.p75_sqm * baseSurface) : null

    return NextResponse.json({
      success: true,
      rol,
      sii_comuna_code: siiComunaCode,
      basis: 'oferta',            // precios de anuncios, no de cierre
      scope,                       // 'radio' (1km) o 'comuna'
      radius_m: scope === 'radio' ? RADIUS_M : null,
      n_comparables: stats.n,
      enough,                      // false = muestra insuficiente para estimar
      median_sqm: stats.median_sqm,
      p25_sqm: stats.p25_sqm,
      p75_sqm: stats.p75_sqm,
      base_surface_m2: baseSurface,
      base_surface_type: baseSurfaceType,
      estimated_value: estimated,
      estimated_min: estimatedMin,
      estimated_max: estimatedMax,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
