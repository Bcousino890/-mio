import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const siiComunaCode = searchParams.get('sii_comuna_code')
    const bbox = searchParams.get('bbox') // "minLng,minLat,maxLng,maxLat"

    if (!siiComunaCode) {
      return NextResponse.json({ error: 'sii_comuna_code required' }, { status: 400 })
    }

    let query = `
      SELECT
        cp.id, cp.rol, cp.source, cp.confidence,
        ST_AsGeoJSON(cp.geom) as geometry_geojson,
        ST_AsGeoJSON(cp.centroid) as centroid_geojson,
        sr.direccion, sr.avaluo_fiscal_total, sr.codigo_destino_principal,
        sr.superficie_terreno_m2
      FROM cadastre_parcels_cl cp
      LEFT JOIN chile_comunas cc ON cp.comuna_id = cc.id
      LEFT JOIN sii_roles_cl sr ON cp.rol = sr.rol AND cc.sii_comuna_code = sr.sii_comuna_code
      WHERE cc.sii_comuna_code = $1
    `

    const params: any[] = [siiComunaCode]

    // Optional: bbox filter
    if (bbox) {
      const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number)
      query += ` AND ST_Intersects(cp.geom, ST_MakeEnvelope($2, $3, $4, $5, 4326))`
      params.push(minLng, minLat, maxLng, maxLat)
    }

    query += ` LIMIT 5000`

    const result = await pool.query(query, params)

    // Convert to GeoJSON FeatureCollection
    const features = result.rows.map((row: any) => {
      const geometry = row.geometry_geojson ? JSON.parse(row.geometry_geojson) : null
      const centroid = row.centroid_geojson ? JSON.parse(row.centroid_geojson) : null

      return {
        type: 'Feature',
        id: row.id,
        geometry: geometry || { type: 'Point', coordinates: centroid ? [centroid.coordinates[0], centroid.coordinates[1]] : [0, 0] },
        properties: {
          rol: row.rol,
          source: row.source,
          confidence: row.confidence,
          direccion: row.direccion,
          avaluo_fiscal_total: row.avaluo_fiscal_total,
          codigo_destino_principal: row.codigo_destino_principal,
          superficie_terreno_m2: row.superficie_terreno_m2,
        },
      }
    })

    return NextResponse.json({
      success: true,
      type: 'FeatureCollection',
      features,
    })
  } catch (error) {
    console.error('Error fetching cadastre GeoJSON:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
