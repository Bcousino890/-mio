import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

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
  // Oportunidades: precio/m² ≥15% bajo la mediana de su comuna+operación
  // (mismo criterio que /chile/oportunidades). with_discount añade
  // median_sqm/discount_ratio a cada fila sin filtrar.
  const onlyOpportunities = sp.get('only_opportunities') === 'true'
  const withDiscount = onlyOpportunities || sp.get('with_discount') === '1'

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
    if (onlyOpportunities) {
      // LEFT JOIN a medians: si la comuna no tiene mediana confiable
      // (<5 anuncios), la condición es false y el anuncio queda fuera.
      conditions.push(`l.price > 0 AND l.square_meters > 0 AND (l.price::numeric / l.square_meters) < m.median_sqm * 0.85`)
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

    // Mediana $/m² por comuna+operación (solo cuando se pide descuento) —
    // misma CTE que /chile/oportunidades.
    const mediansCte = withDiscount
      ? `WITH medians AS (
           SELECT comuna_id, operation,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY price::numeric / square_meters) AS median_sqm
           FROM listings_cl
           WHERE is_active AND price > 0 AND square_meters > 0 AND comuna_id IS NOT NULL
           GROUP BY comuna_id, operation
           HAVING count(*) >= 5
         ) `
      : ''
    const mediansJoin = withDiscount
      ? 'LEFT JOIN medians m ON m.comuna_id = l.comuna_id AND m.operation = l.operation'
      : ''

    const countResult = await pool.query(
      `${mediansCte}SELECT COUNT(*) AS total FROM listings_cl l LEFT JOIN chile_comunas c ON c.id = l.comuna_id ${mediansJoin} ${whereClause}`,
      params
    )
    const total = Number(countResult.rows[0]?.total ?? 0)

    const dataParams = [...params, pageSize, offset]
    const discountSelect = withDiscount
      ? `round(m.median_sqm) AS median_sqm,
         CASE WHEN l.price > 0 AND l.square_meters > 0 AND m.median_sqm > 0
              THEN round((1 - (l.price::numeric / l.square_meters) / m.median_sqm)::numeric, 3)
         END AS discount_ratio,`
      : ''
    const query = `
      ${mediansCte}SELECT
        ${discountSelect}
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
        l.localidad,
        c.name as comuna_name,
        c.sii_comuna_code,
        COALESCE(l.photos, '[]'::jsonb) as photos,
        l.photos_total_count,
        l.price_usd,
        COALESCE(l.features, '[]'::jsonb) as features,
        l.has_video,
        l.video_modal_url,
        l.source_url,
        l.cover_phash,
        l.location_confidence,
        l.rol_matriz_candidate,
        l.identity_score,
        -- Antigüedad REAL del aviso: preferir portal_first_seen_at ("Publicado
        -- hace N días" que declara el propio portal) sobre first_seen_at
        -- (cuándo lo vimos nosotros). Antes usaba last_seen_at, que se
        -- actualiza en cada re-scrape y por eso siempre daba ~0 para
        -- cualquier anuncio activo — no medía antigüedad, medía frescura del
        -- scrape.
        EXTRACT(DAY FROM (now() - COALESCE(l.portal_first_seen_at, l.first_seen_at)))::int as days_on_market,
        l.description,
        l.property_type,
        -- Ficha canónica del inmueble: la lista de anuncios abre la MISMA ficha
        -- que /chile/propiedades (ver components/chile/PropertyClModal).
        l.property_cl_id
      FROM listings_cl l
      LEFT JOIN chile_comunas c ON c.id = l.comuna_id
      ${mediansJoin}
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
