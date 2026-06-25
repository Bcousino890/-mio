import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function GET(request: NextRequest) {
  try {
    const [rolesStats, geocodePending] = await Promise.all([
      // Roles stats per commune
      pool.query(`
        SELECT sii_comuna_code,
               COUNT(*) as total,
               COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) as with_coords,
               COUNT(*) FILTER (WHERE lat IS NULL AND direccion IS NOT NULL) as geocodable
        FROM sii_roles_cl
        WHERE sii_comuna_code IN ('13101', '14201', '15108', '15160', '15161')
        GROUP BY sii_comuna_code ORDER BY sii_comuna_code
      `),

      // How many roles per commune are geocodable (have address but no coords)
      pool.query(`
        SELECT sii_comuna_code,
               COUNT(*) as geocodable_count
        FROM sii_roles_cl
        WHERE sii_comuna_code IN ('14201', '15108', '15160', '15161')
          AND lat IS NULL
          AND direccion IS NOT NULL
        GROUP BY sii_comuna_code ORDER BY sii_comuna_code
      `),
    ])

    return NextResponse.json({
      status: 'ok',
      sii_roles_stats: rolesStats.rows,
      geocode_pending: geocodePending.rows,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
