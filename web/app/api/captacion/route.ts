import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const metric = sp.get('metric') // 'particulares', 'exclusivas', 'market'

  try {
    if (metric === 'particulares') {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM listings
        WHERE advertiser_type = 'particular' AND is_active = true
      `)
      const count = Number(result.rows[0]?.count ?? 0)
      return NextResponse.json({ success: true, count })
    }

    if (metric === 'exclusivas') {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM (
          SELECT COUNT(DISTINCT advertiser_name) as agencies
          FROM listings
          WHERE advertiser_type = 'professional'
            AND is_active = true
            AND rc20 IS NOT NULL
            AND advertiser_name IS NOT NULL
          GROUP BY rc20
          HAVING COUNT(DISTINCT advertiser_name) >= 2
        ) t
      `)
      const count = Number(result.rows[0]?.count ?? 0)
      return NextResponse.json({ success: true, count })
    }

    if (metric === 'leads_list') {
      const limit = Math.min(Number(sp.get('limit')) || 20, 100)
      const result = await pool.query(`
        SELECT
          id, portal, external_id, source_url,
          operation, price, bedrooms, bathrooms, square_meters,
          contact_name, phone, zone_raw, address,
          latitude, longitude, detected_at, last_seen_at
        FROM listings
        WHERE advertiser_type = 'particular' AND is_active = true
        ORDER BY last_seen_at DESC
        LIMIT $1
      `, [limit])
      return NextResponse.json({
        success: true,
        count: result.rows.length,
        data: result.rows,
      })
    }

    return NextResponse.json({ success: false, error: 'Unknown metric' }, { status: 400 })
  } catch (error) {
    console.error('Error fetching captacion data:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
