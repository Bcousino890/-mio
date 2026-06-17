import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

// Reuse existing pool or create new one
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const operation = searchParams.get('operation') // 'rent', 'sale', or null for all
  const limit = Math.min(Number(searchParams.get('limit')) || 500, 5000) // cap at 5000
  const offset = Number(searchParams.get('offset')) || 0
  const portal = searchParams.get('portal') // filter by portal (e.g., 'idealista')

  try {
    let query = `
      SELECT
        external_id as id,
        external_id as property_id,
        title,
        operation,
        price,
        square_meters,
        CASE WHEN square_meters > 0 THEN ROUND(price / square_meters) ELSE 0 END as price_sqm,
        bedrooms,
        bathrooms,
        COALESCE(features, '[]'::jsonb) as features,
        portal,
        source_type,
        advertiser_type,
        advertiser_name,
        is_active,
        latitude,
        longitude,
        address,
        COALESCE(photos, '[]'::jsonb) as photos,
        source_url,
        agency_url,
        agency_crm,
        agency_reference_id,
        agency_domain,
        EXTRACT(DAY FROM (now() - last_seen_at))::int as days_on_market,
        description,
        zone_raw,
        exact_address,
        barrio,
        distrito
      FROM listings
      WHERE is_active = true
    `

    const params: (string | number)[] = []

    if (operation && operation !== 'all') {
      params.push(operation)
      query += ` AND operation = $${params.length}`
    }

    if (portal) {
      params.push(portal)
      query += ` AND portal = $${params.length}`
    }

    query += ` ORDER BY last_seen_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    params.push(limit, offset)

    const result = await pool.query(query, params)

    return NextResponse.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    })
  } catch (error) {
    console.error('Error fetching listings:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
