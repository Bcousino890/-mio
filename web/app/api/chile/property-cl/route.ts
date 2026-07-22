import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// /api/chile/property-cl — propiedades CANÓNICAS deduplicadas (plan Anuncios CL
// · Fase 5 / H22). A diferencia de /api/chile/anuncios (un anuncio = una fila
// de listings_cl), este endpoint expone property_cl: 1 inmueble físico = 1 fila,
// con sus N corredoras/anuncios agrupados por el dedup (Niveles 1+2).
//
//   - Lista (sin `id`): propiedades canónicas con filtros + paginación, más el
//     resumen de corredoras que las publican (para la vista "1 propiedad, N
//     corredoras" y los pines por property_cl del mapa).
//   - Detalle (`?id=<uuid>`): la propiedad + el desglose de sus listings_cl
//     (cada uno con su corredora, precio, estado y URL).
// ─────────────────────────────────────────────────────────────────────────────

const SORT_CLAUSES: Record<string, string> = {
  recent: 'p.last_seen_at DESC',
  price_asc: 'p.canonical_price ASC NULLS LAST',
  price_desc: 'p.canonical_price DESC NULLS LAST',
  corredoras: 'p.corredora_count DESC, p.last_seen_at DESC',
  sqm: '(CASE WHEN p.square_meters > 0 THEN p.canonical_price::numeric / p.square_meters ELSE NULL END) ASC NULLS LAST',
}

// Desglose de anuncios (listings_cl) de una propiedad canónica: cada corredora
// que la publica, con su precio y estado. Se usa tanto en el detalle como para
// enriquecer las filas de la lista con el resumen de sus corredoras.
const LISTINGS_JSON = `
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'listing_id', l.id,
      'external_id', l.external_id,
      'advertiser_id', l.advertiser_id,
      'advertiser_name', l.advertiser_name,
      'corredora_id', l.corredora_id,
      'crm_platform', cor.crm_platform,
      'web_propia_url', cor.web_propia_url,
      'price', l.price,
      'price_uf', l.price_uf,
      'currency', l.currency,
      'source_type', l.source_type,
      'portal', l.portal,
      'source_url', l.source_url,
      'is_active', l.is_active,
      'seller_reference', l.seller_reference,
      'photos', COALESCE(l.photos, '[]'::jsonb),
      'last_seen_at', l.last_seen_at
    ) ORDER BY l.is_active DESC, l.price ASC NULLS LAST)
    FROM listings_cl l
    LEFT JOIN corredoras_cl cor ON cor.id = l.corredora_id
    WHERE l.property_cl_id = p.id
  ), '[]'::jsonb) AS listings
`

// Foto de portada: la primera foto del anuncio activo más reciente del grupo.
const COVER_PHOTO = `
  (SELECT l.photos->>0
   FROM listings_cl l
   WHERE l.property_cl_id = p.id
     AND l.photos IS NOT NULL AND jsonb_array_length(l.photos) > 0
   ORDER BY l.is_active DESC, l.last_seen_at DESC
   LIMIT 1) AS cover_photo
`

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams

  const id = sp.get('id')?.trim()
  const operation = sp.get('operation')
  const comunaName = sp.get('comuna')?.trim()
  const comunaCode = sp.get('comuna_code')?.trim()
  const priceMin = sp.get('price_min') ? Number(sp.get('price_min')) : null
  const priceMax = sp.get('price_max') ? Number(sp.get('price_max')) : null
  const sqmMin = sp.get('sqm_min') ? Number(sp.get('sqm_min')) : null
  const bedroomsMin = sp.get('bedrooms_min') ? Number(sp.get('bedrooms_min')) : null
  // "En canje / sin exclusividad": misma propiedad publicada por >1 corredora.
  const onlyMultiCorredora = sp.get('only_multi_corredora') === 'true'
  const onlyConfirmed = sp.get('only_confirmed') === 'true'

  const sortParam = sp.get('sort')
  const sort = sortParam && SORT_CLAUSES[sortParam] ? sortParam : 'recent'

  const page = Math.max(1, Number(sp.get('page')) || 1)
  const pageSize = Math.min(Math.max(1, Number(sp.get('page_size')) || 30), 200)
  const offset = (page - 1) * pageSize

  try {
    const params: (string | number)[] = []
    const addParam = (value: string | number) => {
      params.push(value)
      return `$${params.length}`
    }

    const conditions: string[] = []
    if (id) {
      conditions.push(`p.id = ${addParam(id)}`)
    } else {
      // La lista muestra por defecto solo propiedades con algún anuncio activo;
      // el detalle por id sí puede traer una ya dada de baja (historial).
      conditions.push('p.is_active = true')
    }
    if (operation && operation !== 'all') conditions.push(`p.operation = ${addParam(operation)}`)
    if (comunaName) conditions.push(`c.name ILIKE ${addParam(`%${comunaName}%`)}`)
    if (comunaCode) conditions.push(`c.sii_comuna_code = ${addParam(comunaCode)}`)
    if (priceMin !== null) conditions.push(`p.canonical_price >= ${addParam(priceMin)}`)
    if (priceMax !== null) conditions.push(`p.canonical_price <= ${addParam(priceMax)}`)
    if (sqmMin !== null) conditions.push(`p.square_meters >= ${addParam(sqmMin)}`)
    if (bedroomsMin !== null) conditions.push(`p.bedrooms >= ${addParam(bedroomsMin)}`)
    if (onlyMultiCorredora) conditions.push('p.corredora_count > 1')
    if (onlyConfirmed) conditions.push(`p.location_confidence = 'confirmed'`)

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : 'WHERE true'

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM property_cl p LEFT JOIN chile_comunas c ON c.id = p.comuna_id ${whereClause}`,
      params
    )
    const total = Number(countResult.rows[0]?.total ?? 0)

    const dataParams = [...params, pageSize, offset]
    const query = `
      SELECT
        p.id,
        p.operation,
        p.property_type,
        p.canonical_price,
        p.canonical_price_uf,
        p.uf_rate,
        p.uf_rate_date,
        p.square_meters,
        CASE WHEN p.square_meters > 0 THEN ROUND(p.canonical_price / p.square_meters) ELSE 0 END AS price_sqm,
        p.bedrooms,
        p.bathrooms,
        p.comuna_id,
        c.name AS comuna_name,
        c.sii_comuna_code,
        p.localidad,
        p.latitude,
        p.longitude,
        p.exact_address,
        p.location_confidence,
        p.rol_matriz,
        p.listing_count,
        p.corredora_count,
        p.portals,
        p.source_types,
        p.advertiser_kinds,
        p.is_active,
        p.first_seen_at,
        p.last_seen_at,
        EXTRACT(DAY FROM (now() - p.first_seen_at))::int AS days_on_market,
        ${COVER_PHOTO},
        ${LISTINGS_JSON}
      FROM property_cl p
      LEFT JOIN chile_comunas c ON c.id = p.comuna_id
      ${whereClause}
      ORDER BY ${SORT_CLAUSES[sort]}
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `

    const result = await pool.query(query, dataParams)

    // Detalle por id: devolver el objeto único (o 404) en vez de una lista de 1.
    if (id) {
      if (result.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'property_cl no encontrada' }, { status: 404 })
      }
      return NextResponse.json({ success: true, data: result.rows[0] })
    }

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
    console.error('Error fetching property_cl:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
