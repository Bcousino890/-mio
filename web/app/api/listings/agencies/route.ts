import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const q = sp.get('q')?.trim() // optional search term for autocomplete

  try {
    let query = `
      SELECT
        COALESCE(l.advertiser_name, 'Unknown') as name,
        l.portal,
        COUNT(*) as listing_count,
        -- Use advertiser_name + portal as composite id (URL-safe)
        CONCAT(REPLACE(LOWER(COALESCE(l.advertiser_name, 'unknown')), ' ', '-'), '_', l.portal) as id
      FROM listings l
      WHERE l.is_active = true
        AND l.advertiser_type = 'professional'
        AND l.advertiser_name IS NOT NULL
        AND l.advertiser_name != ''
    `

    const params: (string | number)[] = []

    if (q) {
      query += ` AND l.advertiser_name ILIKE $1`
      params.push(`%${q}%`)
    }

    query += `
      GROUP BY l.advertiser_name, l.portal
      ORDER BY COUNT(*) DESC, l.advertiser_name ASC
      LIMIT 500
    `

    const result = await pool.query(query, params)

    const agencies = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      portal: row.portal,
      listing_count: row.listing_count
    }))

    return NextResponse.json({
      success: true,
      data: agencies,
    })
  } catch (error) {
    console.error('Error fetching agencies:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
