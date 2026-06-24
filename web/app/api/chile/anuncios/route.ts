import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

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

  const id = sp.get('id')?.trim() // lookup by external_id (MLC-...)
  const operation = sp.get('operation') // 'sale', 'rent', or null/'all'
  const advertiserType = sp.get('advertiser_type') // 'particular', 'professional', or null/'all'
  const q = sp.get('q')?.trim() // free-text search
  const priceMin = sp.get('price_min') ? Number(sp.get('price_min')) : null
  const priceMax = sp.get('price_max') ? Number(sp.get('price_max')) : null
  const sqmMin = sp.get('sqm_min') ? Number(sp.get('sqm_min')) : null
  const sqmMax = sp.get('sqm_max') ? Number(sp.get('sqm_max')) : null
  const bedroomsMin = sp.get('bedrooms_min') ? Number(sp.get('bedrooms_min')) : null
  const bathroomsMin = sp.get('bathrooms_min') ? Number(sp.get('bathrooms_min')) : null
  const onlyDrops = sp.get('only_drops') === 'true'
  const onlyIdentityResolved = sp.get('only_identity_resolved') === 'true'

  // Comuna filter (by name or by sii_comuna_code)
  const comunaName = sp.get('comuna')?.trim()
  const comunaCode = sp.get('comuna_code')?.trim()

  // Geospatial
  const geoPolygon = sp.get('geo_polygon')?.trim()
  const geoCircle = sp.get('geo_circle')?.trim()

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
    if (operation && operation !== 'all') {
      conditions.push(`l.operation = ${addParam(operation)}`)
    }
    if (advertiserType && advertiserType !== 'all') {
      conditions.push(`l.advertiser_type = ${addParam(advertiserType)}`)
    }
    if (q) {
      const term = addParam(`%${q}%`)
      conditions.push(`(l.address ILIKE ${term} OR l.description ILIKE ${term} OR l.advertiser_name ILIKE ${term})`)
    }
    if (priceMin !== null) conditions.push(`l.price >= ${addParam(priceMin)}`)
    if (priceMax !== null) conditions.push(`l.price <= ${addParam(priceMax)}`)
    if (sqmMin !== null) conditions.push(`l.square_meters >= ${addParam(sqmMin)}`)
    if (sqmMax !== null) conditions.push(`l.square_meters <= ${addParam(sqmMax)}`)
    if (bedroomsMin !== null) conditions.push(`l.bedrooms >= ${addParam(bedroomsMin)}`)
    if (bathroomsMin !== null) conditions.push(`l.bathrooms >= ${addParam(bathroomsMin)}`)
    if (onlyDrops) {
      conditions.push(`EXISTS (SELECT 1 FROM listing_version_log_cl lc WHERE lc.listing_id = l.id AND lc.change_type = 'price_down')`)
    }
    if (onlyIdentityResolved) {
      conditions.push(`l.location_confidence = 'confirmed'`)
    }

    // Comuna filtering
    if (comunaName) {
      conditions.push(`c.name ILIKE ${addParam(`%${comunaName}%`)}`)
    }
    if (comunaCode) {
      conditions.push(`c.sii_comuna_code = ${addParam(comunaCode)}`)
    }

    // Geospatial
    if (geoPolygon) {
      try {
        const coords = JSON.parse(geoPolygon) as [number, number][]
        if (coords.length >= 3) {
          const wktCoords = coords.map(([lat, lng]) => `${lng} ${lat}`).join(',')
          const wkt = `POLYGON((${wktCoords}))`
          conditions.push(`ST_Contains(
            ST_GeomFromText(${addParam(wkt)}, 4326),
            l.geom
          )`)
        }
      } catch {
        // ignore invalid geo_polygon
      }
    }

    if (geoCircle) {
      const parts = geoCircle.split(',')
      if (parts.length === 3) {
        const [lat, lng, radiusM] = parts.map(Number)
        if (!isNaN(lat) && !isNaN(lng) && !isNaN(radiusM) && radiusM > 0) {
          conditions.push(`ST_DWithin(
            l.geom::geography,
            ST_SetSRID(ST_Point(${addParam(lng)}, ${addParam(lat)}), 4326)::geography,
            ${addParam(radiusM)}
          )`)
        }
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : 'WHERE true'

    const countResult = await pool.query(`SELECT COUNT(*) AS total FROM listings_cl l LEFT JOIN chile_comunas c ON c.id = l.comuna_id ${whereClause}`, params)
    const total = Number(countResult.rows[0]?.total ?? 0)

    const dataParams = [...params, pageSize, offset]
    const query = `
      SELECT
        l.id,
        l.external_id,
        l.operation,
        l.price,
        l.price_uf,
        l.currency,
        l.square_meters,
        CASE WHEN l.square_meters > 0 THEN ROUND(l.price / l.square_meters) ELSE 0 END as price_sqm,
        l.bedrooms,
        l.bathrooms,
        l.portal,
        l.source_type,
        l.advertiser_type,
        l.advertiser_name,
        l.is_active,
        l.latitude,
        l.longitude,
        l.address,
        c.name as comuna_name,
        c.sii_comuna_code,
        COALESCE(l.photos, '[]'::jsonb) as photos,
        l.source_url,
        l.cover_phash,
        l.location_confidence,
        l.rol_matriz_candidate,
        l.identity_score,
        EXTRACT(DAY FROM (now() - l.last_seen_at))::int as days_on_market,
        l.description,
        l.property_type
      FROM listings_cl l
      LEFT JOIN chile_comunas c ON c.id = l.comuna_id
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
    console.error('Error fetching Chile anuncios:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
