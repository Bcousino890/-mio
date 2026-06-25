import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function GET(request: NextRequest) {
  try {
    const [rolesStats, cadastreStats, sampleMatch, vitacuraSample, cadastreSample] = await Promise.all([
      // Roles stats per commune
      pool.query(`
        SELECT sii_comuna_code,
               COUNT(*) as total,
               COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) as with_coords
        FROM sii_roles_cl
        WHERE sii_comuna_code IN ('13101', '14201', '15108', '15160', '15161')
        GROUP BY sii_comuna_code ORDER BY sii_comuna_code
      `),

      // Check if cadastre_parcels_cl has centroid data
      pool.query(`
        SELECT
          COUNT(*) as total_parcels,
          COUNT(*) FILTER (WHERE centroid IS NOT NULL) as with_centroid
        FROM cadastre_parcels_cl
      `),

      // Check rol format match between tables
      pool.query(`
        SELECT COUNT(*) as matching_rols
        FROM sii_roles_cl sr
        JOIN cadastre_parcels_cl cp ON sr.rol = cp.rol
        WHERE cp.centroid IS NOT NULL
          AND sr.sii_comuna_code IN ('15108', '15160', '15161', '14201')
        LIMIT 1
      `),

      // Sample rols from sii_roles_cl for Vitacura
      pool.query(`
        SELECT rol FROM sii_roles_cl
        WHERE sii_comuna_code = '15160'
        ORDER BY rol LIMIT 5
      `),

      // Sample rols from cadastre_parcels_cl with centroid
      pool.query(`
        SELECT cp.rol, cc.name as commune
        FROM cadastre_parcels_cl cp
        JOIN chile_comunas cc ON cp.comuna_id = cc.id
        WHERE cp.centroid IS NOT NULL
        LIMIT 5
      `),
    ])

    return NextResponse.json({
      status: 'ok',
      sii_roles_stats: rolesStats.rows,
      cadastre_parcels: cadastreStats.rows[0],
      matching_rols_count: sampleMatch.rows[0]?.matching_rols || 0,
      vitacura_rol_sample: vitacuraSample.rows,
      cadastre_rol_sample: cadastreSample.rows,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
