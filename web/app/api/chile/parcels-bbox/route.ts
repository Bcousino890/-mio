import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

/**
 * GET /api/chile/parcels-bbox?bbox=lng1,lat1,lng2,lat2&comuna=15160&limit=2000
 *
 * Devuelve GeoJSON FeatureCollection de predios en el viewport.
 * Requiere zoom alto (bbox pequeño) para no sobrecargar.
 * Máx 2000 predios por request.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const bboxStr = sp.get('bbox')
  const comuna = sp.get('comuna')
  const limit = Math.min(parseInt(sp.get('limit') ?? '2000'), 5000)

  if (!bboxStr) {
    return NextResponse.json({ success: false, error: 'bbox requerido' }, { status: 400 })
  }

  const parts = bboxStr.split(',').map(Number)
  if (parts.length !== 4 || parts.some(isNaN)) {
    return NextResponse.json({ success: false, error: 'bbox inválido: lng1,lat1,lng2,lat2' }, { status: 400 })
  }

  const [lng1, lat1, lng2, lat2] = parts

  // Límite de área para evitar queries masivos (≈ 10km × 10km máx)
  if (Math.abs(lng2 - lng1) > 0.15 || Math.abs(lat2 - lat1) > 0.15) {
    return NextResponse.json({ success: true, features: [], message: 'Zoom más para ver predios' })
  }

  try {
    const whereClause = comuna
      ? `WHERE ST_Intersects(p.geom, ST_MakeEnvelope($1,$2,$3,$4,4326)) AND cc.sii_comuna_code = $5`
      : `WHERE ST_Intersects(p.geom, ST_MakeEnvelope($1,$2,$3,$4,4326))`

    const params = comuna
      ? [lng1, lat1, lng2, lat2, comuna]
      : [lng1, lat1, lng2, lat2]

    const res = await pool.query(
      `SELECT
         p.id,
         p.rol,
         p.comuna_id,
         cc.name AS comuna_name,
         cc.sii_comuna_code,
         ST_AsGeoJSON(ST_SimplifyPreserveTopology(p.geom, 0.000005))::json AS geojson
       FROM cadastre_parcels_cl p
       JOIN chile_comunas cc ON cc.id = p.comuna_id
       ${whereClause}
       LIMIT ${limit}`,
      params
    )

    const features = res.rows.map((row) => ({
      type: 'Feature' as const,
      properties: {
        id: row.id,
        rol: row.rol,
        comuna_id: row.comuna_id,
        comuna_name: row.comuna_name,
        sii_comuna_code: row.sii_comuna_code,
      },
      geometry: row.geojson,
    }))

    return NextResponse.json({
      success: true,
      count: features.length,
      features,
    }, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    })
  } catch (error) {
    console.error('parcels-bbox error:', error)
    return NextResponse.json({ success: false, error: 'Error al obtener predios' }, { status: 500 })
  }
}
