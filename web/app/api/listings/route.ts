import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

// Reuse existing pool or create new one
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

const SORT_CLAUSES: Record<string, string> = {
  recent: 'l.last_seen_at DESC',
  price_asc: 'l.price ASC',
  price_desc: 'l.price DESC',
  sqm: '(CASE WHEN l.square_meters > 0 THEN l.price::numeric / l.square_meters ELSE NULL END) ASC NULLS LAST',
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams

  const id = sp.get('id')?.trim() // lookup a single listing by external_id
  const zoneRaw = sp.get('zone_raw')?.trim() // exact zone match (used for "comparables en la zona")
  const operation = sp.get('operation') // 'rent', 'sale', or null/'all'
  const advertiserType = sp.get('advertiser_type') // 'particular', 'professional', or null/'all'
  const portal = sp.get('portal')
  const q = sp.get('q')?.trim()
  const priceMin = sp.get('price_min') ? Number(sp.get('price_min')) : null
  const priceMax = sp.get('price_max') ? Number(sp.get('price_max')) : null
  const sqmMin = sp.get('sqm_min') ? Number(sp.get('sqm_min')) : null
  const sqmMax = sp.get('sqm_max') ? Number(sp.get('sqm_max')) : null
  const bedroomsMin = sp.get('bedrooms_min') ? Number(sp.get('bedrooms_min')) : null
  const bathroomsMin = sp.get('bathrooms_min') ? Number(sp.get('bathrooms_min')) : null
  const onlyDrops = sp.get('only_drops') === 'true'
  const sortParam = sp.get('sort')
  const sort = sortParam && SORT_CLAUSES[sortParam] ? sortParam : 'recent'

  const page = Math.max(1, Number(sp.get('page')) || 1)
  const pageSize = Math.min(Math.max(1, Number(sp.get('page_size')) || 30), 200)
  const offset = (page - 1) * pageSize

  try {
    const conditions: string[] = ['l.is_active = true']
    const params: (string | number)[] = []
    const addParam = (value: string | number) => {
      params.push(value)
      return `$${params.length}`
    }

    if (id) {
      conditions.push(`l.external_id = ${addParam(id)}`)
    }
    if (zoneRaw) {
      conditions.push(`l.zone_raw = ${addParam(zoneRaw)}`)
    }
    if (operation && operation !== 'all') {
      conditions.push(`l.operation = ${addParam(operation)}`)
    }
    if (advertiserType && advertiserType !== 'all') {
      conditions.push(`l.advertiser_type = ${addParam(advertiserType)}`)
    }
    if (portal) {
      conditions.push(`l.portal = ${addParam(portal)}`)
    }
    if (q) {
      const term = addParam(`%${q}%`)
      conditions.push(`(l.zone_raw ILIKE ${term} OR l.address ILIKE ${term} OR l.description ILIKE ${term})`)
    }
    if (priceMin !== null) conditions.push(`l.price >= ${addParam(priceMin)}`)
    if (priceMax !== null) conditions.push(`l.price <= ${addParam(priceMax)}`)
    if (sqmMin !== null) conditions.push(`l.square_meters >= ${addParam(sqmMin)}`)
    if (sqmMax !== null) conditions.push(`l.square_meters <= ${addParam(sqmMax)}`)
    if (bedroomsMin !== null) conditions.push(`l.bedrooms >= ${addParam(bedroomsMin)}`)
    if (bathroomsMin !== null) conditions.push(`l.bathrooms >= ${addParam(bathroomsMin)}`)
    if (onlyDrops) {
      conditions.push(`EXISTS (SELECT 1 FROM listing_changes lc WHERE lc.listing_id = l.id AND lc.change_type = 'price_down')`)
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`

    const countResult = await pool.query(`SELECT COUNT(*) AS total FROM listings l ${whereClause}`, params)
    const total = Number(countResult.rows[0]?.total ?? 0)

    const dataParams = [...params, pageSize, offset]
    const query = `
      SELECT
        l.external_id as id,
        l.external_id as property_id,
        l.operation,
        l.price,
        l.square_meters,
        CASE WHEN l.square_meters > 0 THEN ROUND(l.price / l.square_meters) ELSE 0 END as price_sqm,
        l.bedrooms,
        l.bathrooms,
        COALESCE(l.features, '[]'::jsonb) as features,
        l.portal,
        l.source_type,
        l.advertiser_type,
        l.advertiser_name,
        l.is_active,
        l.latitude,
        l.longitude,
        l.address,
        COALESCE(l.photos, '[]'::jsonb) as photos,
        l.source_url,
        l.agency_url,
        l.agency_crm,
        l.agency_reference_id,
        l.agency_domain,
        EXTRACT(DAY FROM (now() - l.last_seen_at))::int as days_on_market,
        l.description,
        l.zone_raw,
        (SELECT COUNT(*) FROM listing_changes lc WHERE lc.listing_id = l.id AND lc.change_type = 'price_down') as price_drops,
        -- Backward compatible: empty object for now, will be populated when photos are tagged by source
        jsonb_build_object(l.portal, COALESCE(l.photos, '[]'::jsonb)) as photos_by_source
      FROM listings l
      ${whereClause}
      ORDER BY ${SORT_CLAUSES[sort]}
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `

    const result = await pool.query(query, dataParams)

    return NextResponse.json({
      success: true,
      count: result.rows.length,
      total,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
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
