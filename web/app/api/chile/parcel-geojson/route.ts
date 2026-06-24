import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

/**
 * GET /api/chile/parcel-geojson?rol=795-198&comuna=15108
 *
 * Devuelve el polígono GeoJSON de un predio desde cadastre_parcels_cl
 * (cargado con ogr2ogr desde GeoPackages de catastral.cl).
 * Si no hay polígono, devuelve success:true con parcel:null para que el
 * cliente pueda usar geocodificación de fallback sin error.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const rol = sp.get('rol')?.trim()
  const comuna = sp.get('comuna')?.trim()

  if (!rol || !comuna) {
    return NextResponse.json({ success: false, error: 'rol y comuna requeridos' }, { status: 400 })
  }

  try {
    const res = await pool.query(
      `SELECT
         p.id,
         p.rol,
         ST_AsGeoJSON(p.geom)::json AS geojson,
         ST_Y(ST_Centroid(p.geom)) AS lat,
         ST_X(ST_Centroid(p.geom)) AS lng
       FROM cadastre_parcels_cl p
       JOIN chile_comunas cc ON cc.id = p.comuna_id
       WHERE cc.sii_comuna_code = $1 AND p.rol = $2
       LIMIT 1`,
      [comuna, rol]
    )

    if (res.rows.length === 0) {
      return NextResponse.json({ success: true, parcel: null })
    }

    const row = res.rows[0]
    return NextResponse.json({
      success: true,
      parcel: {
        id: row.id,
        rol: row.rol,
        geojson: row.geojson,
        lat: Number(row.lat),
        lng: Number(row.lng),
      },
    })
  } catch (error) {
    console.error('parcel-geojson error:', error)
    return NextResponse.json({ success: false, error: 'Error al obtener polígono' }, { status: 500 })
  }
}
