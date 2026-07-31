import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import {
  extractListing, setRolFromPin, resolveRolAtPoint, findCrmCaptacionByRol,
  linkCaptacionToProperty,
  type ResolvedRol, type CrmCaptacion,
} from '@/lib/captar-pipeline'
import { scrapeAndUpsertListingCl, extractMlcId, type ScrapeResult } from '@/lib/scrape-listing-cl'

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

// Sin agrupar la fila es el ANUNCIO, así que ordenar por el agregado de la ficha
// daría un orden incoherente con lo que se ve en la tarjeta (dos anuncios de la
// misma ficha comparten agregado pero muestran precios distintos).
const SORT_CLAUSES_UNGROUPED: Record<string, string> = {
  recent: 'l.last_seen_at DESC',
  price_asc: 'l.price ASC NULLS LAST',
  price_desc: 'l.price DESC NULLS LAST',
  corredoras: 'p.corredora_count DESC, l.last_seen_at DESC',
  sqm: '(CASE WHEN l.square_meters > 0 THEN l.price::numeric / l.square_meters ELSE NULL END) ASC NULLS LAST',
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
      'property_code', l.property_code,
      'is_active', l.is_active,
      'manual_property_lock', l.manual_property_lock,
      'seller_reference', l.seller_reference,
      'photos', COALESCE(l.photos, '[]'::jsonb),
      -- Cuántas declara el portal: sin este número no se puede saber si a la
      -- ficha le faltan fotos o si el aviso simplemente tiene pocas.
      'photos_total_count', l.photos_total_count,
      'description', l.description,
      'address', l.address,
      'latitude', l.latitude,
      'longitude', l.longitude,
      'features', COALESCE(l.features, '[]'::jsonb),
      'square_meters', l.square_meters,
      'bedrooms', l.bedrooms,
      'bathrooms', l.bathrooms,
      'has_video', l.has_video,
      'video_modal_url', l.video_modal_url,
      'stored_video', l.stored_video,
      'last_seen_at', l.last_seen_at
    ) ORDER BY l.is_active DESC, l.price ASC NULLS LAST)
    FROM listings_cl l
    LEFT JOIN corredoras_cl cor ON cor.id = l.corredora_id
    WHERE l.property_cl_id = p.id
  ), '[]'::jsonb) AS listings
`

// ¿Está ya captado el inmueble en el CRM de captación (dueño/teléfonos para
// llamar)? Se busca primero por el ENLACE guardado al captar desde la ficha
// (property_cl.captacion_id, 0083) y, como respaldo, por rol_matriz + comuna
// (captaciones creadas antes del enlace o desde /chile/captar-url).
//
// Va tanto en el detalle como en la LISTA: es lo que permite que la tarjeta de
// la grilla lleve la etiqueta "captada" sin una consulta aparte.
// "Captada" = tiene el enlace guardado. Es una sola condición sobre una columna
// indexada, así que sirve igual para la etiqueta de la tarjeta, para el filtro y
// para el contador — los tres dicen exactamente lo mismo. El enlace lo escriben
// el PATCH de la ficha, el pipeline al fijar el rol y el backfill de la 0083.
const CAPTADA_PREDICATE = `p.captacion_id IS NOT NULL`

const CRM_JSON = `
  (CASE WHEN p.captacion_id IS NOT NULL OR (p.rol_matriz IS NOT NULL AND c.sii_comuna_code IS NOT NULL) THEN (
     SELECT jsonb_build_object(
       'captacion_id', cap.id,
       'owner_name', cap.owner_name,
       'owner_rut', cap.owner_rut,
       'phones', cap.phones,
       'emails', cap.emails,
       'relacionados', cap.relacionados,
       -- Dueños del rol según el Buscador Múltiple (actual / histórico): es lo
       -- que deja pedir los teléfonos de un RUT concreto desde la ficha.
       'owner_rut_candidates', cap.owner_rut_candidates,
       'stage', cap.stage,
       'dealernet_status', cap.dealernet_status,
       'needs_review', cap.needs_review,
       'source_url', cap.source_url,
       'updated_at', cap.updated_at
     )
     FROM captaciones_cl cap
     WHERE cap.id = p.captacion_id
        OR (p.rol_matriz IS NOT NULL AND c.sii_comuna_code IS NOT NULL
            AND cap.sii_rol = p.rol_matriz AND cap.sii_comuna_code = c.sii_comuna_code)
     ORDER BY (cap.id = p.captacion_id) DESC,
              (cap.owner_name IS NOT NULL) DESC, (cap.phones IS NOT NULL) DESC, cap.updated_at DESC
     LIMIT 1
   ) ELSE NULL END) AS crm
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

// Relee una ficha por id con la misma forma que una fila de la lista (usado
// tras un scraping puntual on-demand, ver bloque `q` en GET más abajo — el
// buscador necesita el mismo shape que ya consume la grilla, no el objeto de
// detalle "suelto" que devuelve `?id=`).
async function fetchPropertyClRowById(id: string) {
  const { rows } = await pool.query(
    `SELECT
       p.id, p.id AS row_key, p.ref_code, p.operation, p.property_type,
       p.canonical_price, p.canonical_price_uf, p.uf_rate, p.uf_rate_date,
       p.square_meters,
       CASE WHEN p.square_meters > 0 THEN ROUND(p.canonical_price::numeric / p.square_meters) ELSE 0 END AS price_sqm,
       p.bedrooms, p.bathrooms, p.comuna_id, c.name AS comuna_name, c.sii_comuna_code,
       p.localidad, p.latitude, p.longitude, p.exact_address, p.location_confidence, p.rol_matriz,
       p.listing_count, p.corredora_count, p.portals, p.source_types, p.advertiser_kinds,
       p.is_active, p.first_seen_at, p.last_seen_at, p.portal_first_seen_at,
       p.manual_latitude, p.manual_longitude, p.manual_pin_set_at, p.smart_crm_at, p.captacion_id, p.manual_merge_at,
       EXTRACT(DAY FROM (now() - COALESCE(p.portal_first_seen_at, p.first_seen_at)))::int AS days_on_market,
       ${COVER_PHOTO},
       ${CRM_JSON},
       ${LISTINGS_JSON}
     FROM property_cl p LEFT JOIN chile_comunas c ON c.id = p.comuna_id
     WHERE p.id = $1`,
    [id]
  )
  return rows[0] ?? null
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams

  const id = sp.get('id')?.trim()
  const operation = sp.get('operation')
  const comunaName = sp.get('comuna')?.trim()
  // Buscador por código o URL (código de propiedad, código de anuncio MLC-id,
  // código interno del CRM `ref_code`, o URL pegada del portal): ver bloque
  // más abajo donde se arma la condición SQL.
  const q = sp.get('q')?.trim() || null
  const comunaCode = sp.get('comuna_code')?.trim()
  const priceMin = sp.get('price_min') ? Number(sp.get('price_min')) : null
  const priceMax = sp.get('price_max') ? Number(sp.get('price_max')) : null
  const sqmMin = sp.get('sqm_min') ? Number(sp.get('sqm_min')) : null
  const bedroomsMin = sp.get('bedrooms_min') ? Number(sp.get('bedrooms_min')) : null
  // "En canje / sin exclusividad": misma propiedad publicada por >1 corredora.
  const onlyMultiCorredora = sp.get('only_multi_corredora') === 'true'
  const onlyConfirmed = sp.get('only_confirmed') === 'true'
  // Estado de captación del inmueble: "ya la trabajé" (tiene ficha en
  // captaciones_cl) y "ya la subí al CRM externo (Smart)". Son los dos estados
  // que la grilla marca con etiqueta, así que también se pueden filtrar.
  const onlyCaptadas = sp.get('only_captadas') === 'true'
  const onlySmart = sp.get('only_smart') === 'true'
  // AGRUPAR (`grouped=1`) = una ficha por INMUEBLE: junta los anuncios que
  // comparten corredora + código interno, incluidos los que la misma corredora
  // publica a la vez en venta y en arriendo. Es opt-in a propósito: por defecto
  // la lista enseña UN anuncio = UNA ficha, para que el recuento cuadre con lo
  // que muestra el portal y no parezca que faltan propiedades.
  const grouped = sp.get('grouped') === '1'

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

    // El detalle por id SIEMPRE va contra la ficha canónica (property_cl): la
    // vista sin agrupar solo cambia CÓMO se lista, no qué es una ficha.
    const listUngrouped = !id && !grouped

    // Sin agrupar, la fila es el ANUNCIO: los filtros de precio/superficie/
    // operación tienen que mirar al anuncio, no al agregado de la ficha (si no,
    // un anuncio de arriendo saldría bajo el filtro "venta" solo porque su ficha
    // agrupa ambos, que es justo lo que la vista sin agrupar quiere separar).
    const F = listUngrouped
      ? { operation: 'l.operation', price: 'l.price', sqm: 'l.square_meters', bedrooms: 'l.bedrooms', active: 'l.is_active' }
      : { operation: 'p.operation', price: 'p.canonical_price', sqm: 'p.square_meters', bedrooms: 'p.bedrooms', active: 'p.is_active' }

    // LEFT JOIN a property_cl, NO inner: un anuncio recién guardado todavía no
    // tiene ficha asignada (se la pone el dedup, que corre cada 15 min). Con
    // inner join esos anuncios quedaban INVISIBLES en la lista — exactamente el
    // "faltan propiedades" que esta vista existe para evitar.
    const fromClause = listUngrouped
      ? `FROM listings_cl l
         LEFT JOIN property_cl p ON p.id = l.property_cl_id
         LEFT JOIN chile_comunas c ON c.id = COALESCE(l.comuna_id, p.comuna_id)`
      : `FROM property_cl p LEFT JOIN chile_comunas c ON c.id = p.comuna_id`

    const conditions: string[] = []
    if (id) {
      conditions.push(`p.id = ${addParam(id)}`)
    } else {
      // La lista muestra por defecto solo lo que sigue publicado; el detalle por
      // id sí puede traer una ficha ya dada de baja (historial).
      conditions.push(`${F.active} = true`)
    }
    if (operation && operation !== 'all') conditions.push(`${F.operation} = ${addParam(operation)}`)
    if (comunaName) conditions.push(`c.name ILIKE ${addParam(`%${comunaName}%`)}`)
    // Si `q` es un código/URL de Portal Inmobiliario y no aparece en la
    // búsqueda, se usa más abajo para scrapearlo en vivo (ver bloque tras la
    // consulta principal).
    let qMlcId: string | null = null
    if (q) {
      // Acepta: código de propiedad ML ("5495"), código interno de la
      // corredora (seller_reference), código interno del CRM (ref_code, ej.
      // "PI-2607-00042"), código/URL del anuncio (MLC-id, ej. "MLC-2009525691"
      // o una URL completa de portalinmobiliario.com que lo contenga), o la
      // URL del anuncio pegada tal cual.
      const mlcId = extractMlcId(q)
      qMlcId = mlcId
      const likeParam = addParam(`%${q}%`)
      const exactParam = addParam(q)
      const listingMatch = mlcId
        ? `${listUngrouped ? 'l' : 'lq'}.external_id = ${addParam(mlcId)}`
        : `(${listUngrouped ? 'l' : 'lq'}.property_code = ${exactParam} OR ${listUngrouped ? 'l' : 'lq'}.seller_reference = ${exactParam} OR ${listUngrouped ? 'l' : 'lq'}.external_id ILIKE ${likeParam})`
      const sourceUrlMatch = `${listUngrouped ? 'l' : 'lq'}.source_url ILIKE ${likeParam}`
      conditions.push(
        listUngrouped
          ? `(p.ref_code ILIKE ${likeParam} OR ${listingMatch} OR ${sourceUrlMatch})`
          : `(p.ref_code ILIKE ${likeParam} OR EXISTS (SELECT 1 FROM listings_cl lq WHERE lq.property_cl_id = p.id AND (${listingMatch} OR ${sourceUrlMatch})))`
      )
    }
    if (comunaCode) conditions.push(`c.sii_comuna_code = ${addParam(comunaCode)}`)
    if (priceMin !== null) conditions.push(`${F.price} >= ${addParam(priceMin)}`)
    if (priceMax !== null) conditions.push(`${F.price} <= ${addParam(priceMax)}`)
    if (sqmMin !== null) conditions.push(`${F.sqm} >= ${addParam(sqmMin)}`)
    if (bedroomsMin !== null) conditions.push(`${F.bedrooms} >= ${addParam(bedroomsMin)}`)
    if (onlyMultiCorredora) conditions.push('p.corredora_count > 1')
    if (onlyConfirmed) conditions.push(`p.location_confidence = 'confirmed'`)
    if (onlyCaptadas) conditions.push(CAPTADA_PREDICATE)
    if (onlySmart) conditions.push('p.smart_crm_at IS NOT NULL')

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : 'WHERE true'

    // Estadísticas agregadas sobre TODO el conjunto filtrado (no solo la página):
    // total, en canje, mediana de precio y ubicación confirmada — para la barra
    // de resumen de la UI. Una sola consulta en vez de varias.
    const statsResult = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE p.corredora_count > 1) AS multi_corredora,
         COUNT(*) FILTER (WHERE p.location_confidence = 'confirmed') AS confirmed,
         COUNT(*) FILTER (WHERE ${CAPTADA_PREDICATE}) AS captadas,
         COUNT(*) FILTER (WHERE p.smart_crm_at IS NOT NULL) AS smart,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY ${F.price})
           FILTER (WHERE ${F.price} > 0) AS median_price
       ${fromClause} ${whereClause}`,
      params
    )
    const statsRow = statsResult.rows[0] ?? {}
    const total = Number(statsRow.total ?? 0)
    const stats = {
      total,
      multi_corredora: Number(statsRow.multi_corredora ?? 0),
      confirmed: Number(statsRow.confirmed ?? 0),
      captadas: Number(statsRow.captadas ?? 0),
      smart: Number(statsRow.smart ?? 0),
      median_price: statsRow.median_price != null ? Math.round(Number(statsRow.median_price)) : null,
    }

    const dataParams = [...params, pageSize, offset]
    const query = `
      SELECT
        ${listUngrouped ? 'COALESCE(p.id, l.id)' : 'p.id'} AS id,
        -- Clave de fila: sin agrupar hay una fila por ANUNCIO, así que dos
        -- anuncios de la misma ficha comparten el mismo id de propiedad (y
        -- abren la misma ficha, que es lo correcto) pero necesitan claves
        -- distintas en la grilla.
        ${listUngrouped ? 'l.id' : 'p.id'} AS row_key,
        p.ref_code,
        ${F.operation} AS operation,
        p.property_type,
        ${F.price} AS canonical_price,
        ${listUngrouped ? 'l.price_uf' : 'p.canonical_price_uf'} AS canonical_price_uf,
        p.uf_rate,
        p.uf_rate_date,
        ${F.sqm} AS square_meters,
        CASE WHEN ${F.sqm} > 0 THEN ROUND(${F.price}::numeric / ${F.sqm}) ELSE 0 END AS price_sqm,
        ${F.bedrooms} AS bedrooms,
        ${listUngrouped ? 'l.bathrooms' : 'p.bathrooms'} AS bathrooms,
        p.comuna_id,
        c.name AS comuna_name,
        c.sii_comuna_code,
        p.localidad,
        p.latitude,
        p.longitude,
        p.exact_address,
        p.location_confidence,
        p.rol_matriz,
        ${listUngrouped ? '1' : 'p.listing_count'} AS listing_count,
        ${listUngrouped ? '1' : 'p.corredora_count'} AS corredora_count,
        p.portals,
        p.source_types,
        p.advertiser_kinds,
        ${F.active} AS is_active,
        p.first_seen_at,
        p.last_seen_at,
        p.portal_first_seen_at,
        p.manual_latitude,
        p.manual_longitude,
        p.manual_pin_set_at,
        -- Marca manual "ya subida al CRM externo (Smart)" — para no duplicar el
        -- alta comercial; se enciende/apaga desde la ficha (0082).
        p.smart_crm_at,
        -- Enlace a la captación creada desde la ficha (0083): la tarjeta lo usa
        -- para marcar "captada" y la ficha para abrir /chile/captacion.
        p.captacion_id,
        -- Sello de la última unión/separación MANUAL (0079): la ficha lleva el
        -- distintivo "unido a mano" para no confundir un grupo curado por el
        -- equipo con uno propuesto por el score del dedup.
        p.manual_merge_at,
        -- días en mercado REALES: preferir portal_first_seen_at (antigüedad que
        -- el propio portal declara, "Publicado hace N días") sobre first_seen_at
        -- (cuándo NOSOTROS lo vimos, que subestima si el discovery llegó tarde
        -- a la comuna — ver 0076).
        EXTRACT(DAY FROM (now() - COALESCE(p.portal_first_seen_at, p.first_seen_at)))::int AS days_on_market,
        ${listUngrouped ? '(l.photos->>0) AS cover_photo' : COVER_PHOTO},
        ${CRM_JSON},
        ${LISTINGS_JSON}
      ${fromClause}
      ${whereClause}
      ORDER BY ${(listUngrouped ? SORT_CLAUSES_UNGROUPED : SORT_CLAUSES)[sort]}
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `

    const result = await pool.query(query, dataParams)

    // Búsqueda por código/URL de Portal Inmobiliario sin resultados: se
    // scrapea la ficha EN VIVO (no depende del barrido 24/7 ni de la cola de
    // dedup, ver scrape-listing-cl.ts) y se devuelve ya creada — "si no está,
    // se trae". Solo aplica cuando `q` identificó un MLC-id real: un código
    // interno suelto sin match ("5495") no tiene URL que scrapear.
    if (!id && q && qMlcId && result.rows.length === 0) {
      const scraped: ScrapeResult = await scrapeAndUpsertListingCl(q).catch((e): ScrapeResult => ({
        ok: false,
        error: e instanceof Error ? e.message : 'Error al scrapear el anuncio',
      }))
      if (scraped.ok) {
        const fresh = await fetchPropertyClRowById(scraped.propertyId)
        if (fresh) {
          return NextResponse.json({
            success: true, count: 1, total: 1, stats,
            page: 1, page_size: pageSize, total_pages: 1,
            data: [fresh], scraped: true,
          })
        }
      }
      return NextResponse.json({
        success: true, count: 0, total: 0, stats,
        page, page_size: pageSize, total_pages: 1,
        data: [], scrape_error: scraped.ok ? null : scraped.error,
      })
    }

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
      stats,
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

// PATCH — pin manual (corrección del equipo, pedido explícito del usuario:
// "el pin que puse yo"). NO reemplaza latitude/longitude (el declarado por el
// anuncio, ver 0064/0077) — es un segundo pin aparte para poder comparar en la
// ficha. Guardarlo marca location_confidence='confirmed' (reusa el enum: un
// humano confirmando la ubicación a mano es el caso de máxima confianza).
// Body: { id: string, latitude: number, longitude: number, source_url?: string }
// — o { id, latitude: null, longitude: null } para borrar el pin manual.
//
// Si viene `source_url` (el aviso cuya ubicación declarada se está
// corrigiendo) y se está guardando un pin (no borrando), además:
//   1. busca la parcela SII que contiene ese punto (findRolAtPoint — mismo
//      point-in-polygon que el visor de catastro), y
//   2. crea/actualiza la captación de ese aviso en captaciones_cl con ese rol
//      ya resuelto (setRolFromPin) — así el pin corregido a mano entra solo
//      al pipeline de captación (dueño vía TGR, contacto vía DealerNet) sin
//      que el equipo tenga que volver a pegar la URL en /chile/captar-url.
// Es best-effort: si falla, el pin igual queda guardado.
// URL de origen con la que captar la ficha: el aviso activo más reciente que
// tenga source_url. Solo se usa como respaldo cuando el cliente no la manda.
async function findListingSourceUrl(propertyId: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT source_url FROM listings_cl
      WHERE property_cl_id = $1 AND source_url IS NOT NULL AND source_url <> ''
      ORDER BY is_active DESC, last_seen_at DESC
      LIMIT 1`,
    [propertyId],
  )
  return rows[0]?.source_url ?? null
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, latitude, longitude, source_url, smart_crm } = body ?? {}

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ success: false, error: 'Falta id' }, { status: 400 })
    }

    // Marca manual "ya subida al CRM externo (Smart)" — independiente del pin.
    // Body: { id, smart_crm: true } para marcar, { id, smart_crm: false } para
    // desmarcar. No es una integración con Smart: solo el estado que declara el
    // equipo para no duplicar el alta comercial.
    if (typeof smart_crm === 'boolean') {
      const { rows } = await pool.query(
        `UPDATE property_cl
           SET smart_crm_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now()
         WHERE id = $1
         RETURNING id, smart_crm_at`,
        [id, smart_crm],
      )
      if (rows.length === 0) {
        return NextResponse.json({ success: false, error: 'property_cl no encontrada' }, { status: 404 })
      }
      return NextResponse.json({ success: true, data: rows[0] })
    }

    const clearing = latitude == null && longitude == null
    if (!clearing && (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude))) {
      return NextResponse.json({ success: false, error: 'latitude/longitude deben ser números (o ambos null para borrar)' }, { status: 400 })
    }

    // El "¿se está borrando el pin?" viaja como un booleano propio ($4) en vez
    // de preguntar `CASE WHEN $2 IS NULL`. Con esa forma, Postgres no podía
    // deducir el tipo de $2 (el driver no declara tipos y `$2 IS NULL` no da
    // ninguna pista) y la consulta reventaba SIEMPRE con
    // «could not determine data type of parameter $2»: el pin manual nunca se
    // llegó a guardar, y con él tampoco el rol ni la captación. La ficha lo
    // ocultaba porque daba por buena la respuesta sin mirar `success`.
    const { rows } = await pool.query(
      `UPDATE property_cl SET
         manual_latitude = $2, manual_longitude = $3,
         manual_pin_set_at = CASE WHEN $4 THEN NULL ELSE now() END,
         location_confidence = CASE WHEN $4 THEN location_confidence ELSE 'confirmed' END,
         updated_at = now()
       WHERE id = $1
       RETURNING id, manual_latitude, manual_longitude, manual_pin_set_at, location_confidence`,
      [id, clearing ? null : latitude, clearing ? null : longitude, clearing]
    )
    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'property_cl no encontrada' }, { status: 404 })
    }

    // Resolver el rol SII de la parcela BAJO el pin corregido y COMPLETAR la
    // ficha del inmueble con esa info real (rol, dirección exacta, parcela). El
    // pin arrastrado a mano ES la ubicación real, así que el rol se resuelve por
    // geometría (point-in-polygon sobre el catastro), no por matching de texto.
    let rol: ResolvedRol | null = null
    let crm: CrmCaptacion | null = null
    let captacion: { id: string; sii_rol: string | null; comuna_name: string | null } | null = null
    let captacionError: string | null = null

    if (!clearing) {
      try {
        rol = await resolveRolAtPoint(latitude, longitude)
        if (rol) {
          // Persistir el rol confirmado a mano en la ficha canónica (máxima
          // confianza: lo confirmó un humano). NO pisa latitude/longitude —
          // el pin declarado por el anuncio sigue intacto; esto es la capa
          // "resuelta" (rol_matriz + dirección exacta + parcela catastral).
          await pool.query(
            `UPDATE property_cl SET
               rol_matriz = $2, rol_confidence = 1, matched_parcel_id = $3,
               exact_address = COALESCE($4, exact_address), updated_at = now()
             WHERE id = $1`,
            [id, rol.rol, rol.parcel_id, rol.direccion],
          )
          crm = await findCrmCaptacionByRol(rol.rol, rol.sii_comuna_code)
        } else {
          captacionError = 'No se encontró parcela SII bajo el pin (catastro sin cargar en esa zona)'
        }
      } catch (e) {
        captacionError = e instanceof Error ? e.message : 'Error al resolver el rol bajo el pin'
      }

      // Si además tenemos la URL del aviso cuya ubicación se está corrigiendo,
      // crear/actualizar su captación con el rol ya resuelto — así el pin
      // corregido entra solo al pipeline de captación (dueño vía TGR, contacto
      // vía DealerNet) sin volver a pegar la URL en /chile/captar-url.
      //
      // La URL la manda el cliente (el aviso que se está viendo en la ficha),
      // pero si no viene la buscamos aquí: dejar de captar por un campo que el
      // front no envió era justo el caso de "guardé y no pasó nada" — la ficha
      // quedaba con rol y sin captación, sin dueño ni teléfonos.
      const listingUrl = (typeof source_url === 'string' && source_url)
        ? source_url
        : await findListingSourceUrl(id)

      if (rol && listingUrl) {
        try {
          const { captacion: c } = await extractListing(listingUrl)
          const updated = await setRolFromPin(c.id, rol.rol, rol.sii_comuna_code, rol.direccion)
          // Enlace permanente ficha ↔ captación (0083): es lo que permite que
          // la tarjeta de la grilla se marque "captada" y que la fila de
          // /chile/captacion sepa volver a este inmueble.
          await linkCaptacionToProperty(updated.id, id)
          captacion = { id: updated.id, sii_rol: updated.sii_rol, comuna_name: rol.comuna_name }
          // La captación recién sincronizada puede ser la más completa: refrescar.
          crm = (await findCrmCaptacionByRol(rol.rol, rol.sii_comuna_code)) ?? crm
        } catch (e) {
          captacionError = captacionError ?? (e instanceof Error ? e.message : 'Error al guardar en captación')
        }
      } else if (rol && !listingUrl) {
        captacionError = captacionError ?? 'La ficha no tiene ningún aviso con URL de origen para captar'
      }
    }

    return NextResponse.json({ success: true, data: rows[0], rol, crm, captacion, captacion_error: captacionError })
  } catch (error) {
    console.error('Error guardando pin manual de property_cl:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
