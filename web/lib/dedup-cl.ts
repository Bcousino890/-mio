// dedup-cl.ts — Duplicado (TS) de un subconjunto de `scraper/lib/dedup-cl.mjs`
// (createPropertyCl + la regla de agrupación de Nivel 1), igual motivo que
// parse-portalinmobiliario-cl.ts: web/ y scraper/ son proyectos Node
// separados y el build Docker de web/ no incluye scraper/lib.
//
// Solo cubre lo que necesita el scraping puntual on-demand (ver
// scrape-listing-cl.ts): enlazar/crear el property_cl de UN listing recién
// insertado, con la MISMA regla que el barrido masivo (mismo advertiser_id Y
// mismo seller_reference → misma ficha; si no, standalone). El resto de
// runNivel1DedupCl (recorrer TODOS los pendientes de la tabla) sigue viviendo
// solo en el worker 24/7 — no hace falta aquí.

import type { Pool } from 'pg'

const LOCATION_CONFIDENCE_RANK: Record<string, number> = { confirmed: 3, candidate: 2, none: 1, pin_suspect: 0 }
function rankOf(confidence: string | null): number {
  return confidence != null ? (LOCATION_CONFIDENCE_RANK[confidence] ?? -1) : -1
}

export interface ConsolidationRow {
  id: string
  external_id: string | null
  property_cl_id: string | null
  operation: string | null
  property_type: string | null
  price: number | null
  price_uf: number | null
  uf_rate: number | null
  uf_rate_date: string | null
  square_meters: number | null
  bedrooms: number | null
  bathrooms: number | null
  comuna_id: string | null
  localidad: string | null
  latitude: number | null
  longitude: number | null
  location_confidence: string | null
  exact_address: string | null
  portal: string | null
  source_type: string | null
  advertiser_type: string | null
  advertiser_id: string | null
  is_active: boolean
  first_seen_at: string
  last_seen_at: string
  portal_first_seen_at: string | null
  manual_property_lock?: boolean
}

// Mismas reglas que consolidateFields() en scraper/lib/dedup-cl.mjs — ver ahí
// el detalle de cada regla (moda, precio mínimo activo, mejor confianza...).
export function consolidateFields(rows: ConsolidationRow[]) {
  const best = rows.reduce((a, b) => (rankOf(b.location_confidence) > rankOf(a.location_confidence) ? b : a))

  const mode = <K extends keyof ConsolidationRow>(key: K) => {
    const counts = new Map<ConsolidationRow[K], { count: number; lastSeen: string }>()
    for (const r of rows) {
      const v = r[key]
      if (v == null) continue
      const entry = counts.get(v) ?? { count: 0, lastSeen: r.last_seen_at }
      entry.count += 1
      if (r.last_seen_at > entry.lastSeen) entry.lastSeen = r.last_seen_at
      counts.set(v, entry)
    }
    let winner: { v: ConsolidationRow[K]; e: { count: number; lastSeen: string } } | null = null
    for (const [v, e] of counts) {
      if (!winner || e.count > winner.e.count || (e.count === winner.e.count && e.lastSeen > winner.e.lastSeen)) {
        winner = { v, e }
      }
    }
    return winner?.v ?? null
  }

  const activeRows = rows.filter((r) => r.is_active)
  const priceSource = activeRows.length > 0 ? activeRows : rows
  const cheapest = priceSource.reduce((a, b) => {
    if (a.price == null) return b
    if (b.price == null) return a
    return b.price < a.price ? b : a
  }, priceSource[0])

  const portals = [...new Set(rows.map((r) => r.portal).filter((v): v is string => Boolean(v)))]
  const sourceTypes = [...new Set(rows.map((r) => r.source_type).filter((v): v is string => Boolean(v)))]
  const advertiserKinds = [...new Set(rows.map((r) => r.advertiser_type).filter((v) => v === 'particular' || v === 'professional'))]
  const distinctAdvertisers = new Set(rows.map((r) => r.advertiser_id).filter(Boolean))
  const corredoraCount = distinctAdvertisers.size > 0 ? distinctAdvertisers.size : (rows.length > 0 ? 1 : 0)

  return {
    operation: mode('operation'),
    property_type: mode('property_type'),
    canonical_price: cheapest?.price ?? null,
    canonical_price_uf: cheapest?.price_uf ?? null,
    uf_rate: cheapest?.uf_rate ?? null,
    uf_rate_date: cheapest?.uf_rate_date ?? null,
    square_meters: mode('square_meters'),
    bedrooms: mode('bedrooms'),
    bathrooms: mode('bathrooms'),
    comuna_id: best.comuna_id,
    localidad: best.localidad,
    latitude: best.latitude,
    longitude: best.longitude,
    location_confidence: best.location_confidence,
    exact_address: best.exact_address ?? null,
    listing_count: rows.length,
    corredora_count: corredoraCount,
    portals,
    source_types: sourceTypes,
    advertiser_kinds: advertiserKinds,
    is_active: rows.some((r) => r.is_active),
    first_seen_at: rows.reduce((min, r) => (r.first_seen_at < min ? r.first_seen_at : min), rows[0].first_seen_at),
    last_seen_at: rows.reduce((max, r) => (r.last_seen_at > max ? r.last_seen_at : max), rows[0].last_seen_at),
    portal_first_seen_at: rows.reduce((min: string | null, r) => {
      if (r.portal_first_seen_at == null) return min
      return min == null || r.portal_first_seen_at < min ? r.portal_first_seen_at : min
    }, null),
  }
}

const LISTING_FIELDS_FOR_CONSOLIDATION = `
  id, external_id, property_cl_id, operation, property_type, price, price_uf, uf_rate, uf_rate_date,
  square_meters, bedrooms, bathrooms, comuna_id, localidad, latitude, longitude,
  location_confidence, exact_address, portal, source_type, advertiser_type,
  advertiser_id, is_active, first_seen_at, last_seen_at, portal_first_seen_at
`

export async function createPropertyCl(pool: Pool, rows: ConsolidationRow[]): Promise<string> {
  const c = consolidateFields(rows)
  const { rows: inserted } = await pool.query(
    `INSERT INTO property_cl (
       operation, property_type, canonical_price, canonical_price_uf, uf_rate, uf_rate_date,
       square_meters, bedrooms, bathrooms, comuna_id, localidad, latitude, longitude,
       location_confidence, exact_address, listing_count, corredora_count,
       portals, source_types, advertiser_kinds, is_active, first_seen_at, last_seen_at, portal_first_seen_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     RETURNING id`,
    [
      c.operation, c.property_type, c.canonical_price, c.canonical_price_uf, c.uf_rate, c.uf_rate_date,
      c.square_meters, c.bedrooms, c.bathrooms, c.comuna_id, c.localidad, c.latitude, c.longitude,
      c.location_confidence, c.exact_address, c.listing_count, c.corredora_count,
      c.portals, c.source_types, c.advertiser_kinds, c.is_active, c.first_seen_at, c.last_seen_at, c.portal_first_seen_at,
    ]
  )
  const propertyClId = inserted[0].id as string

  const externalIds = rows.map((r) => r.external_id).filter(Boolean)
  if (externalIds.length > 0) {
    await pool.query(
      `UPDATE property_cl p SET manual_latitude = b.manual_latitude,
                                manual_longitude = b.manual_longitude,
                                updated_at = now()
         FROM property_cl_manual_pin_backup b
        WHERE p.id = $1 AND b.external_id = ANY($2::text[])
          AND b.manual_latitude IS NOT NULL`,
      [propertyClId, externalIds]
    )
  }

  return propertyClId
}

export async function refreshPropertyClAggregates(pool: Pool, propertyClId: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT ${LISTING_FIELDS_FOR_CONSOLIDATION} FROM listings_cl WHERE property_cl_id = $1`,
    [propertyClId]
  )
  if (rows.length === 0) return
  const c = consolidateFields(rows as ConsolidationRow[])
  // El refresco NO puede pisar el trabajo del equipo ni el dato del catastro con
  // lo que traiga (o deje de traer) un anuncio:
  //   · location_confidence — un pin colocado a mano ES la confirmación de
  //     ubicación. Recalcularlo desde los anuncios devolvía la ficha a "sin
  //     confirmar" en el siguiente barrido: se captaba y al rato la etiqueta
  //     "Rol SII" había desaparecido sola.
  //   · exact_address — sale del catastro SII al resolver el rol, no del aviso;
  //     un anuncio sin dirección la borraba.
  //   · comuna/coordenadas — que una re-lectura no las parsee no significa que
  //     el inmueble se haya quedado sin comuna.
  await pool.query(
    `UPDATE property_cl SET
       operation = $2, property_type = $3, canonical_price = $4, canonical_price_uf = $5,
       uf_rate = $6, uf_rate_date = $7, square_meters = $8, bedrooms = $9, bathrooms = $10,
       comuna_id = COALESCE($11::uuid, comuna_id), localidad = COALESCE($12::text, localidad),
       latitude = COALESCE($13::numeric, latitude), longitude = COALESCE($14::numeric, longitude),
       location_confidence = CASE WHEN manual_pin_set_at IS NOT NULL THEN 'confirmed' ELSE $15::text END,
       exact_address = CASE WHEN rol_matriz IS NOT NULL THEN COALESCE(exact_address, $16::text)
                            ELSE COALESCE($16::text, exact_address) END,
       listing_count = $17,
       corredora_count = $18, portals = $19, source_types = $20, advertiser_kinds = $21,
       is_active = $22, first_seen_at = $23, last_seen_at = $24, portal_first_seen_at = $25, updated_at = now()
     WHERE id = $1`,
    [
      propertyClId, c.operation, c.property_type, c.canonical_price, c.canonical_price_uf,
      c.uf_rate, c.uf_rate_date, c.square_meters, c.bedrooms, c.bathrooms,
      c.comuna_id, c.localidad, c.latitude, c.longitude,
      c.location_confidence, c.exact_address, c.listing_count,
      c.corredora_count, c.portals, c.source_types, c.advertiser_kinds,
      c.is_active, c.first_seen_at, c.last_seen_at, c.portal_first_seen_at,
    ]
  )
}

/**
 * Enlaza/crea el property_cl de UN listing recién insertado (scraping
 * puntual, ver scrape-listing-cl.ts) — misma regla que runNivel1DedupCl
 * (scraper/lib/dedup-cl.mjs) pero acotada a la familia de este listing en vez
 * de recorrer toda la tabla: dos anuncios son la MISMA propiedad solo si
 * coinciden advertiser_id Y seller_reference; si no, cada uno es su propia
 * ficha (Fase 5, H22 — ver docs/PLAN-ANUNCIOS-CL.md).
 */
export async function linkSingleListingToPropertyCl(pool: Pool, listingId: string): Promise<string> {
  const { rows: selfRows } = await pool.query(
    `SELECT ${LISTING_FIELDS_FOR_CONSOLIDATION}, manual_property_lock, seller_reference
     FROM listings_cl WHERE id = $1`,
    [listingId]
  )
  const self = selfRows[0]
  if (!self) throw new Error(`listings_cl ${listingId} no encontrado`)
  // Ya tenía ficha: no hay nada que enlazar, pero el aviso ACABA de cambiar
  // (esta función se llama justo después del upsert del scraping puntual), así
  // que sus agregados hay que rehacerlos. Sin esto, buscar una propiedad por
  // código la re-scrapeaba entera y la ficha seguía mostrando el precio, la
  // comuna y los m² viejos — o vacíos: "se traen los datos y no aparecen".
  if (self.property_cl_id) {
    await refreshPropertyClAggregates(pool, self.property_cl_id as string)
    return self.property_cl_id as string
  }

  const sellerRef = typeof self.seller_reference === 'string' ? self.seller_reference.trim() : ''
  let family: ConsolidationRow[] = [self]
  if (self.advertiser_id && sellerRef && !self.manual_property_lock) {
    const { rows } = await pool.query(
      `SELECT ${LISTING_FIELDS_FOR_CONSOLIDATION}, manual_property_lock FROM listings_cl
       WHERE advertiser_id = $1 AND lower(btrim(seller_reference)) = lower(btrim($2))`,
      [self.advertiser_id, sellerRef]
    )
    if (rows.length > 0) family = rows as ConsolidationRow[]
  }

  const unlocked = family.filter((r) => !r.manual_property_lock)
  if (unlocked.length === 0) unlocked.push(self)

  const existingId =
    unlocked.find((r) => r.property_cl_id)?.property_cl_id ??
    family.find((r) => r.property_cl_id)?.property_cl_id ??
    null

  const propertyClId = existingId ?? (await createPropertyCl(pool, unlocked))

  const listingIds = unlocked.map((r) => r.id)
  await pool.query(
    `UPDATE listings_cl SET property_cl_id = $1, match_confidence = 1, updated_at = now()
     WHERE id = ANY($2::uuid[]) AND property_cl_id IS DISTINCT FROM $1
       AND NOT manual_property_lock`,
    [propertyClId, listingIds]
  )

  if (existingId) await refreshPropertyClAggregates(pool, propertyClId)

  return propertyClId
}
