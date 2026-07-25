// ─────────────────────────────────────────────────────────────────────────────
// Matching MANUAL de propiedades canónicas chilenas (property_cl) — migración
// 0079.
//
// El dedup automático agrupa anuncios por score (Nivel 1 determinista + Nivel 2
// probabilístico, ver 0064 y scraper/lib/clustering-cl.mjs). Cuando se queda
// corto —dos corredoras publicando el mismo inmueble con m² distintos, fotos
// distintas y el pin a media cuadra— quedan 2 fichas para 1 propiedad. Aquí
// vive la corrección a mano que hace el equipo desde /chile/propiedades:
//
//   · mergePropertiesCl  — unir N property_cl en una sola (arrastrar una ficha
//     sobre otra, o seleccionar varias y unirlas).
//   · splitListingsCl    — sacar anuncios de una propiedad a una ficha nueva
//     (deshacer una unión, propia o del dedup automático).
//
// Ambas dejan la decisión BLINDADA contra el próximo barrido automático:
// `listings_cl.manual_property_lock` frena a Nivel 1 y los pares
// `listing_match_cl` con `decided_by='human'` (confirmed al unir, rejected al
// separar) orientan a Nivel 2. Y ambas quedan registradas en
// `property_merge_log_cl` con el detalle para auditar/revertir.
//
// `consolidateFields` es el ESPEJO en TypeScript de la función homónima de
// `scraper/lib/dedup-cl.mjs` (mismo criterio de campos ganadores: coords del
// anuncio con mayor location_confidence, moda para m²/dorm./baños, precio
// mínimo vigente). Se replica en vez de importarse porque el contenedor `app`
// se construye solo con `web/` como contexto (infra/docker-compose.yml) y no
// ve `scraper/` — mismo patrón que web/lib/uf-rate-cl.ts. Si cambia el
// criterio en un lado, cambiarlo en el otro.
// ─────────────────────────────────────────────────────────────────────────────
import type { PoolClient } from 'pg'

export type ConsolidationRow = {
  id: string
  external_id: string | null
  property_cl_id: string | null
  operation: string | null
  property_type: string | null
  price: number | null
  price_uf: string | null
  uf_rate: string | null
  uf_rate_date: Date | string | null
  square_meters: number | null
  bedrooms: number | null
  bathrooms: number | null
  comuna_id: string | null
  localidad: string | null
  latitude: string | null
  longitude: string | null
  location_confidence: string
  exact_address: string | null
  portal: string | null
  source_type: string | null
  advertiser_type: string | null
  advertiser_id: string | null
  is_active: boolean
  first_seen_at: Date | string
  last_seen_at: Date | string
  portal_first_seen_at: Date | string | null
}

// Columnas que necesita consolidateFields, en el mismo orden y con los mismos
// nombres que LISTING_FIELDS_FOR_CONSOLIDATION de scraper/lib/dedup-cl.mjs.
export const LISTING_FIELDS_FOR_CONSOLIDATION = `
  id, external_id, property_cl_id, operation, property_type, price, price_uf, uf_rate, uf_rate_date,
  square_meters, bedrooms, bathrooms, comuna_id, localidad, latitude, longitude,
  location_confidence, exact_address, portal, source_type, advertiser_type,
  advertiser_id, is_active, first_seen_at, last_seen_at, portal_first_seen_at
`

// 'pin_suspect' NO es "mejor que candidate": es una señal explícita de pin
// sospechoso, así que para elegir de quién nos fiamos vale menos que un anuncio
// que ni se intentó triangular (ver identity-resolution-cl.mjs).
const LOCATION_CONFIDENCE_RANK: Record<string, number> = {
  confirmed: 3, candidate: 2, none: 1, pin_suspect: 0,
}
const rankOf = (c: string | null) => (c != null ? LOCATION_CONFIDENCE_RANK[c] ?? -1 : -1)
const ms = (v: Date | string | null) => (v == null ? null : new Date(v).getTime())

export type ConsolidatedFields = {
  operation: string | null
  property_type: string | null
  canonical_price: number | null
  canonical_price_uf: string | null
  uf_rate: string | null
  uf_rate_date: Date | string | null
  square_meters: number | null
  bedrooms: number | null
  bathrooms: number | null
  comuna_id: string | null
  localidad: string | null
  latitude: string | null
  longitude: string | null
  location_confidence: string
  exact_address: string | null
  listing_count: number
  corredora_count: number
  portals: string[]
  source_types: string[]
  advertiser_kinds: string[]
  is_active: boolean
  first_seen_at: Date | string
  last_seen_at: Date | string
  portal_first_seen_at: Date | string | null
}

/** Espejo de consolidateFields() de scraper/lib/dedup-cl.mjs. */
export function consolidateFields(rows: ConsolidationRow[]): ConsolidatedFields {
  const best = rows.reduce((a, b) => (rankOf(b.location_confidence) > rankOf(a.location_confidence) ? b : a))

  // Moda del campo; ante empate gana el valor del anuncio visto más recientemente.
  const mode = <K extends keyof ConsolidationRow>(key: K): ConsolidationRow[K] | null => {
    const counts = new Map<unknown, { count: number; lastSeen: number }>()
    for (const r of rows) {
      const v = r[key]
      if (v == null) continue
      const seen = ms(r.last_seen_at) ?? 0
      const entry = counts.get(v) ?? { count: 0, lastSeen: seen }
      entry.count += 1
      if (seen > entry.lastSeen) entry.lastSeen = seen
      counts.set(v, entry)
    }
    let winner: { v: unknown; count: number; lastSeen: number } | null = null
    for (const [v, e] of counts) {
      if (!winner || e.count > winner.count || (e.count === winner.count && e.lastSeen > winner.lastSeen)) {
        winner = { v, count: e.count, lastSeen: e.lastSeen }
      }
    }
    return (winner?.v ?? null) as ConsolidationRow[K] | null
  }

  // "Precio de mercado": el mínimo entre los anuncios ACTIVOS (si ninguno lo
  // está, el mínimo histórico del grupo).
  const activeRows = rows.filter(r => r.is_active)
  const priceSource = activeRows.length > 0 ? activeRows : rows
  const cheapest = priceSource.reduce((a, b) => {
    if (a.price == null) return b
    if (b.price == null) return a
    return b.price < a.price ? b : a
  }, priceSource[0])

  const portals = [...new Set(rows.map(r => r.portal).filter((v): v is string => !!v))]
  const sourceTypes = [...new Set(rows.map(r => r.source_type).filter((v): v is string => !!v))]
  const advertiserKinds = [...new Set(
    rows.map(r => r.advertiser_type).filter((v): v is string => v === 'particular' || v === 'professional')
  )]
  const distinctAdvertisers = new Set(rows.map(r => r.advertiser_id).filter(Boolean))
  const corredoraCount = distinctAdvertisers.size > 0 ? distinctAdvertisers.size : (rows.length > 0 ? 1 : 0)

  const minDate = (key: 'first_seen_at' | 'portal_first_seen_at') =>
    rows.reduce<Date | string | null>((min, r) => {
      const v = r[key]
      if (v == null) return min
      if (min == null) return v
      return (ms(v) ?? 0) < (ms(min) ?? 0) ? v : min
    }, null)

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
    is_active: rows.some(r => r.is_active),
    first_seen_at: minDate('first_seen_at') ?? rows[0].first_seen_at,
    last_seen_at: rows.reduce<Date | string>((max, r) => ((ms(r.last_seen_at) ?? 0) > (ms(max) ?? 0) ? r.last_seen_at : max), rows[0].last_seen_at),
    // Antigüedad REAL en el mercado: la primera corredora que lo publicó (0076).
    portal_first_seen_at: minDate('portal_first_seen_at'),
  }
}

/** Recalcula los agregados de un property_cl desde TODOS sus listings actuales. */
export async function refreshPropertyClAggregates(client: PoolClient, propertyClId: string): Promise<void> {
  const { rows } = await client.query<ConsolidationRow>(
    `SELECT ${LISTING_FIELDS_FOR_CONSOLIDATION} FROM listings_cl WHERE property_cl_id = $1`,
    [propertyClId]
  )
  if (rows.length === 0) return
  const c = consolidateFields(rows)
  await client.query(
    `UPDATE property_cl SET
       operation = $2, property_type = $3, canonical_price = $4, canonical_price_uf = $5,
       uf_rate = $6, uf_rate_date = $7, square_meters = $8, bedrooms = $9, bathrooms = $10,
       comuna_id = $11, localidad = $12, latitude = $13, longitude = $14,
       location_confidence = $15, exact_address = $16, listing_count = $17,
       corredora_count = $18, portals = $19, source_types = $20, advertiser_kinds = $21,
       is_active = $22, first_seen_at = $23, last_seen_at = $24, portal_first_seen_at = $25,
       updated_at = now()
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

async function createPropertyCl(client: PoolClient, rows: ConsolidationRow[]): Promise<{ id: string; ref_code: string | null }> {
  const c = consolidateFields(rows)
  const { rows: inserted } = await client.query<{ id: string; ref_code: string | null }>(
    `INSERT INTO property_cl (
       operation, property_type, canonical_price, canonical_price_uf, uf_rate, uf_rate_date,
       square_meters, bedrooms, bathrooms, comuna_id, localidad, latitude, longitude,
       location_confidence, exact_address, listing_count, corredora_count,
       portals, source_types, advertiser_kinds, is_active, first_seen_at, last_seen_at,
       portal_first_seen_at, manual_merge_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24, now())
     RETURNING id, ref_code`,
    [
      c.operation, c.property_type, c.canonical_price, c.canonical_price_uf, c.uf_rate, c.uf_rate_date,
      c.square_meters, c.bedrooms, c.bathrooms, c.comuna_id, c.localidad, c.latitude, c.longitude,
      c.location_confidence, c.exact_address, c.listing_count, c.corredora_count,
      c.portals, c.source_types, c.advertiser_kinds, c.is_active, c.first_seen_at, c.last_seen_at,
      c.portal_first_seen_at,
    ]
  )
  return inserted[0]
}

type PropertyMeta = { id: string; ref_code: string | null; listing_count: number; created_at: Date }

/**
 * Superviviente por defecto de una unión, con el MISMO criterio determinista
 * que chooseSurvivorPropertyCl() de scraper/lib/clustering-cl.mjs:
 *   1. la que más anuncios tiene (menos reasignación),
 *   2. desempate por la creada antes (más asentada),
 *   3. desempate final por id (estable).
 * La UI puede pasar `survivor_id` explícito y saltarse esto.
 */
export function chooseSurvivor(candidates: PropertyMeta[]): string | null {
  if (candidates.length === 0) return null
  return [...candidates].sort((x, y) => {
    if ((y.listing_count ?? 0) !== (x.listing_count ?? 0)) return (y.listing_count ?? 0) - (x.listing_count ?? 0)
    const xc = x.created_at ? new Date(x.created_at).getTime() : Infinity
    const yc = y.created_at ? new Date(y.created_at).getTime() : Infinity
    if (xc !== yc) return xc - yc
    return String(x.id) < String(y.id) ? -1 : 1
  })[0].id
}

type MovedListing = {
  listing_id: string
  external_id: string | null
  advertiser_name: string | null
  from_property_cl_id: string | null
  from_ref_code: string | null
  prev_match_confidence: number | null
}

// Par ordenado (a < b): listing_match_cl tiene UNIQUE(listing_a, listing_b) y
// todo el pipeline inserta el par ordenado (ver 0028).
const orderedPair = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x])

/**
 * Registra la decisión humana sobre pares de anuncios en listing_match_cl, para
 * que el dedup automático la respete: 'confirmed' (score 1) mantiene el grupo
 * en Nivel 2; 'rejected' (score 0) evita que lo vuelva a fusionar.
 */
async function recordHumanEdges(
  client: PoolClient,
  pairs: [string, string][],
  status: 'confirmed' | 'rejected',
  reason: string
): Promise<void> {
  if (pairs.length === 0) return
  const score = status === 'confirmed' ? 1 : 0
  const signals = JSON.stringify({ source: 'manual_ui', reason })
  const values: string[] = []
  const params: unknown[] = [status, score, signals]
  for (const [a, b] of pairs) {
    params.push(a, b)
    values.push(`($${params.length - 1}::uuid, $${params.length}::uuid, $2::numeric, $3::jsonb, $1, 'human', now())`)
  }
  await client.query(
    `INSERT INTO listing_match_cl (listing_a, listing_b, score, signals, status, decided_by, decided_at)
     VALUES ${values.join(', ')}
     ON CONFLICT (listing_a, listing_b) DO UPDATE SET
       score = EXCLUDED.score, signals = EXCLUDED.signals, status = EXCLUDED.status,
       decided_by = 'human', decided_at = now()`,
    params
  )
}

export type MergeResult = {
  survivor_id: string
  survivor_ref_code: string | null
  absorbed: { id: string; ref_code: string | null }[]
  moved_listings: number
  log_id: string
}

/**
 * Une N property_cl en una sola: todos los anuncios pasan a la superviviente,
 * las absorbidas se borran (quedan sin anuncios) y la decisión se blinda contra
 * el dedup automático. Idempotente en la práctica: unir algo ya unido no hace
 * nada (se filtran las propiedades que no existen y las repetidas).
 */
export async function mergePropertiesCl(
  client: PoolClient,
  { ids, survivorId, note }: { ids: string[]; survivorId?: string | null; note?: string | null }
): Promise<MergeResult> {
  const unique = [...new Set(ids)]
  if (unique.length < 2) throw new Error('Se necesitan al menos 2 propiedades distintas para unir')

  // FOR UPDATE: dos personas uniendo las mismas fichas a la vez se serializan
  // en vez de dejar anuncios apuntando a una propiedad ya borrada.
  const { rows: props } = await client.query<PropertyMeta>(
    `SELECT id, ref_code, listing_count, created_at FROM property_cl
     WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    [unique]
  )
  if (props.length < 2) throw new Error('Alguna de las propiedades ya no existe (¿se unió en otra pestaña?)')

  const chosen = survivorId && props.some(p => p.id === survivorId) ? survivorId : chooseSurvivor(props)!
  const survivor = props.find(p => p.id === chosen)!
  const absorbed = props.filter(p => p.id !== chosen)

  // Anuncios que se mudan, con su origen — es lo que permite revertir después.
  const refByProperty = new Map(props.map(p => [p.id, p.ref_code]))
  const { rows: moving } = await client.query<{
    id: string; external_id: string | null; advertiser_name: string | null
    property_cl_id: string; match_confidence: string | null
  }>(
    `SELECT id, external_id, advertiser_name, property_cl_id, match_confidence
     FROM listings_cl WHERE property_cl_id = ANY($1::uuid[])`,
    [absorbed.map(p => p.id)]
  )
  const moved: MovedListing[] = moving.map(l => ({
    listing_id: l.id,
    external_id: l.external_id,
    advertiser_name: l.advertiser_name,
    from_property_cl_id: l.property_cl_id,
    from_ref_code: refByProperty.get(l.property_cl_id) ?? null,
    prev_match_confidence: l.match_confidence != null ? Number(l.match_confidence) : null,
  }))

  if (moving.length > 0) {
    await client.query(
      `UPDATE listings_cl
       SET property_cl_id = $1, match_confidence = 1, manual_property_lock = true, updated_at = now()
       WHERE id = ANY($2::uuid[])`,
      [chosen, moving.map(l => l.id)]
    )
  }

  // Aristas humanas contra un ancla de la superviviente: con eso Nivel 2 ve una
  // componente conexa única y vuelve a elegir a la superviviente (tiene más
  // anuncios), en vez de rearmar los grupos anteriores.
  const { rows: anchorRows } = await client.query<{ id: string }>(
    `SELECT id FROM listings_cl WHERE property_cl_id = $1 AND id <> ALL($2::uuid[])
     ORDER BY is_active DESC, first_seen_at ASC LIMIT 1`,
    [chosen, moving.map(l => l.id)]
  )
  const anchor = anchorRows[0]?.id ?? null
  if (anchor) {
    await recordHumanEdges(
      client,
      moving.map(l => orderedPair(anchor, l.id)),
      'confirmed',
      'union manual desde /chile/propiedades'
    )
  }

  // Las absorbidas quedan sin anuncios → se borran (misma política de huérfanos
  // que clustering-cl.mjs). La condición NOT EXISTS es la red de seguridad: si
  // algo quedó apuntando, la propiedad sobrevive en vez de dejar anuncios sueltos.
  const deletable = absorbed.map(p => p.id)
  if (deletable.length > 0) {
    await client.query(
      `DELETE FROM property_cl p
       WHERE p.id = ANY($1::uuid[])
         AND NOT EXISTS (SELECT 1 FROM listings_cl l WHERE l.property_cl_id = p.id)`,
      [deletable]
    )
  }

  await refreshPropertyClAggregates(client, chosen)
  await client.query(`UPDATE property_cl SET manual_merge_at = now(), updated_at = now() WHERE id = $1`, [chosen])

  const { rows: logRows } = await client.query<{ id: string }>(
    `INSERT INTO property_merge_log_cl
       (action, property_cl_id, property_ref_code, other_property_ids, other_ref_codes, moved, listing_count, note)
     VALUES ('merge', $1, $2, $3::uuid[], $4::text[], $5::jsonb, $6, $7)
     RETURNING id`,
    [
      chosen, survivor.ref_code, absorbed.map(p => p.id), absorbed.map(p => p.ref_code ?? ''),
      JSON.stringify(moved), moved.length, note ?? null,
    ]
  )

  return {
    survivor_id: chosen,
    survivor_ref_code: survivor.ref_code,
    absorbed: absorbed.map(p => ({ id: p.id, ref_code: p.ref_code })),
    moved_listings: moved.length,
    log_id: logRows[0].id,
  }
}

export type SplitResult = {
  source_id: string
  new_property_id: string
  new_ref_code: string | null
  moved_listings: number
  log_id: string
}

/**
 * Saca anuncios de una propiedad a una ficha NUEVA — deshacer una unión (propia
 * o del dedup automático) sin perder los anuncios. Los pares separados quedan
 * como 'rejected' humanos en listing_match_cl para que el clustering no los
 * vuelva a juntar.
 */
export async function splitListingsCl(
  client: PoolClient,
  { propertyId, listingIds, note }: { propertyId: string; listingIds: string[]; note?: string | null }
): Promise<SplitResult> {
  const wanted = [...new Set(listingIds)]
  if (wanted.length === 0) throw new Error('No se indicó qué anuncios separar')

  const { rows: source } = await client.query<{ id: string; ref_code: string | null }>(
    `SELECT id, ref_code FROM property_cl WHERE id = $1 FOR UPDATE`,
    [propertyId]
  )
  if (source.length === 0) throw new Error('property_cl no encontrada')

  const { rows: family } = await client.query<ConsolidationRow & { advertiser_name: string | null; match_confidence: string | null }>(
    `SELECT ${LISTING_FIELDS_FOR_CONSOLIDATION}, advertiser_name, match_confidence
     FROM listings_cl WHERE property_cl_id = $1`,
    [propertyId]
  )
  const movingRows = family.filter(l => wanted.includes(l.id))
  const stayingRows = family.filter(l => !wanted.includes(l.id))
  if (movingRows.length === 0) throw new Error('Esos anuncios no pertenecen a la propiedad')
  if (stayingRows.length === 0) throw new Error('No se puede separar el 100% de los anuncios: la propiedad quedaría vacía')

  const created = await createPropertyCl(client, movingRows)
  await client.query(
    `UPDATE listings_cl
     SET property_cl_id = $1, match_confidence = 1, manual_property_lock = true, updated_at = now()
     WHERE id = ANY($2::uuid[])`,
    [created.id, movingRows.map(l => l.id)]
  )

  const pairs: [string, string][] = []
  for (const m of movingRows) for (const s of stayingRows) pairs.push(orderedPair(m.id, s.id))
  await recordHumanEdges(client, pairs, 'rejected', 'separacion manual desde /chile/propiedades')

  await refreshPropertyClAggregates(client, propertyId)
  await client.query(
    `UPDATE property_cl SET manual_merge_at = now(), updated_at = now() WHERE id = ANY($1::uuid[])`,
    [[propertyId, created.id]]
  )

  const moved: MovedListing[] = movingRows.map(l => ({
    listing_id: l.id,
    external_id: l.external_id,
    advertiser_name: l.advertiser_name,
    from_property_cl_id: propertyId,
    from_ref_code: source[0].ref_code,
    prev_match_confidence: l.match_confidence != null ? Number(l.match_confidence) : null,
  }))

  const { rows: logRows } = await client.query<{ id: string }>(
    `INSERT INTO property_merge_log_cl
       (action, property_cl_id, property_ref_code, other_property_ids, other_ref_codes, moved, listing_count, note)
     VALUES ('split', $1, $2, $3::uuid[], $4::text[], $5::jsonb, $6, $7)
     RETURNING id`,
    [propertyId, source[0].ref_code, [created.id], [created.ref_code ?? ''], JSON.stringify(moved), moved.length, note ?? null]
  )

  return {
    source_id: propertyId,
    new_property_id: created.id,
    new_ref_code: created.ref_code,
    moved_listings: moved.length,
    log_id: logRows[0].id,
  }
}
