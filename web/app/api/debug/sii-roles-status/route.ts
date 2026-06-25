import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function GET(request: NextRequest) {
  try {
    const results = await Promise.all([
      // Count total roles by comuna
      pool.query(`
        SELECT
          sii_comuna_code,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) as with_coords
        FROM sii_roles_cl
        WHERE sii_comuna_code IN ('13101', '15108', '15160', '15161', '14201')
        GROUP BY sii_comuna_code
        ORDER BY sii_comuna_code
      `),

      // Test Las Condes API response count
      pool.query(`
        SELECT COUNT(*) as count
        FROM sii_roles_cl
        WHERE sii_comuna_code = '15160' AND lat IS NOT NULL AND lng IS NOT NULL
      `),
    ])

    const stats = results[0].rows
    const vitacuraCount = results[1].rows[0]?.count || 0

    return NextResponse.json({
      status: 'ok',
      database_stats: stats,
      vitacura_sample_count: vitacuraCount,
      note: 'If vitacura_sample_count is 0, coordinates not populated. If > 0, API should return data.',
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
