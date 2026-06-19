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

  // Advanced filter parameters
  const location = sp.get('location')?.trim()
  const characteristics = sp.get('characteristics')?.split(',').filter(Boolean) // comma-separated
  const propertyType = sp.get('property_type')?.split(',').filter(Boolean) // comma-separated
  const furnished = sp.get('furnished') // 'true' | 'false'
  const view = sp.get('view') // e.g., 'sea', 'mountain', 'city'
  const orientation = sp.get('orientation') // e.g., 'north', 'south', 'east', 'west'
  const energyRating = sp.get('energy_rating') // e.g., 'A', 'B', 'C', 'D', 'E'
  const yearBuiltMin = sp.get('year_built_min') ? Number(sp.get('year_built_min')) : null
  const yearBuiltMax = sp.get('year_built_max') ? Number(sp.get('year_built_max')) : null
  const pricePerSqmMin = sp.get('price_per_sqm_min') ? Number(sp.get('price_per_sqm_min')) : null
  const pricePerSqmMax = sp.get('price_per_sqm_max') ? Number(sp.get('price_per_sqm_max')) : null
  // Nuevos parámetros de ubicación normalizada (migración 0019)
  const districtId = sp.get('district_id')?.trim()
  const zoneId = sp.get('zone_id')?.trim()
  const subzoneId = sp.get('subzone_id')?.trim()

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

    // Advanced filter conditions
    // Location search: zone_raw or address (text search)
    if (location) {
      const locationTerm = addParam(`%${location}%`)
      conditions.push(`(l.zone_raw ILIKE ${locationTerm} OR l.address ILIKE ${locationTerm})`)
    }

    // Characteristics filtering: features is JSONB array, check if all requested are present
    if (characteristics && characteristics.length > 0) {
      characteristics.forEach(c => {
        conditions.push(`l.features @> ${addParam(JSON.stringify([c]))}::jsonb`)
      })
    }

    // Property type filtering
    if (propertyType && propertyType.length > 0) {
      const typeParams = propertyType.map(t => addParam(t))
      conditions.push(`l.property_type IN (${typeParams.join(',')})`)
    }

    // Price per sqm filtering (computed, not stored)
    if (pricePerSqmMin !== null || pricePerSqmMax !== null) {
      const priceSqm = `(CASE WHEN l.square_meters > 0 THEN l.price::numeric / l.square_meters ELSE NULL END)`
      if (pricePerSqmMin !== null) conditions.push(`${priceSqm} >= ${addParam(pricePerSqmMin)}`)
      if (pricePerSqmMax !== null) conditions.push(`${priceSqm} <= ${addParam(pricePerSqmMax)}`)
    }

    // Energy rating filtering
    if (energyRating) {
      conditions.push(`l.energy_rating = ${addParam(energyRating)}`)
    }

    // Note: furnished, view, orientation, and year_built require additional DB columns
    // They are parsed from query params but not yet implemented in the schema

    // Filtros de ubicación normalizada (migración 0019)
    // Notas:
    // - district_id, zone_id, subzone_id están denormalizados en listings
    // - Se pueden combinar: filtrar por distrito + zona + subzona
    // - Si se proporciona subzone_id, automáticamente está dentro de zone_id y district_id
    if (districtId) {
      conditions.push(`l.district_id = ${addParam(districtId)}`)
    }
    if (zoneId) {
      conditions.push(`l.zone_id = ${addParam(zoneId)}`)
    }
    if (subzoneId) {
      conditions.push(`l.subzone_id = ${addParam(subzoneId)}`)
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
