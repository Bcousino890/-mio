import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function GET(request: NextRequest) {
  try {
    const result = await pool.query(`
      SELECT
        sii_comuna_code,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) AS with_coords,
        COUNT(*) FILTER (WHERE lat IS NULL) AS without_coords,
        COUNT(*) FILTER (WHERE lat IS NULL AND direccion IS NOT NULL) AS geocodable,
        COUNT(*) FILTER (WHERE lat IS NULL AND direccion IS NULL) AS no_address_no_coords,
        ROUND(100.0 * COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL)
              / NULLIF(COUNT(*), 0), 2) AS coverage_pct
      FROM sii_roles_cl
      WHERE sii_comuna_code IN ('15160', '15108', '15161', '14201')
      GROUP BY sii_comuna_code
      ORDER BY sii_comuna_code
    `)

    const rows = result.rows
    const totalAll = rows.reduce((s, r) => s + Number(r.total), 0)
    const withCoordsAll = rows.reduce((s, r) => s + Number(r.with_coords), 0)
    const geocodableAll = rows.reduce((s, r) => s + Number(r.geocodable), 0)

    return NextResponse.json({
      status: 'ok',
      summary: {
        total: totalAll,
        with_coords: withCoordsAll,
        coverage_pct: totalAll > 0 ? Math.round(10000 * withCoordsAll / totalAll) / 100 : 0,
        geocodable_remaining: geocodableAll,
      },
      by_commune: rows.map((r) => ({
        sii_comuna_code: r.sii_comuna_code,
        total: Number(r.total),
        with_coords: Number(r.with_coords),
        without_coords: Number(r.without_coords),
        geocodable: Number(r.geocodable),
        no_address_no_coords: Number(r.no_address_no_coords),
        coverage_pct: Number(r.coverage_pct),
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
