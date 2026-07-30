// ─────────────────────────────────────────────────────────────────────────────
// Upsert de un anuncio parseado (parseDetailPage) hacia listings_cl, con
// trazabilidad de cambios (listing_version_log_cl, 0034) y snapshot crudo
// inmutable (snapshot-cl.mjs, H13). Es la pieza que faltaba entre "tengo el
// JSON parseado de una ficha" y "está reflejado en la base" — el job
// `detail:<mlc_id>` del worker (H2) la llama por cada MLC-id a refrescar.
//
// FUERA DE ALCANCE (deliberado): detectar que un anuncio DEJÓ de aparecer en
// el portal ('delisted'). Esta función solo actúa cuando SÍ hay datos frescos
// de una ficha — la detección de baja compara el barrido completo de una
// comuna contra lo que ya había en listings_cl, y eso vive en el discovery
// crawler (H1, todavía bloqueado por Fase 0), no aquí.
//
// Precio UF/CLP: reutiliza resolvePriceClp/resolvePriceUf de to-listing.mjs
// (ya escritas y usadas por la UI) en vez de reimplementar la conversión.
// ufRate/ufRateDate se pasan por parámetro — esta función NO hace I/O de red
// (ni siquiera para la tasa UF), a propósito, igual que toAppListingCl: la
// resuelve el caller (worker-cl.mjs, vía uf-rate-cl.mjs) una sola vez por
// corrida, no una vez por listing.
// ─────────────────────────────────────────────────────────────────────────────
import { normalizeComuna } from './chile-comunas.mjs'
import { resolvePriceClp, resolvePriceUf } from './to-listing.mjs'
import { recordSnapshotCl } from './snapshot-cl.mjs'

/**
 * Monedas que `listings_cl.currency` acepta (CHECK de la migración 0028), que
 * son también las únicas cuyo importe sabemos interpretar.
 *
 * El parser copia `currency_id` del blob de Mercado Libre tal cual cuando no es
 * "CLF" (= UF), así que un anuncio publicado en otra moneda —el catálogo real
 * trae unos pocos— llegaba aquí con un código que el CHECK rechaza: el INSERT
 * lanzaba, la ficha no se guardaba NUNCA y su job volvía a fallar en cada
 * pasada. Visto en producción: 4 fichas con
 * 'new row for relation "listings_cl" violates check constraint'.
 *
 * Se normaliza a CLP para que la fila entre, pero SIN inventar el importe: el
 * precio queda en null (ver resolvePriceClp en to-listing.mjs). Mejor un
 * anuncio sin precio que uno con el número de otra moneda haciéndose pasar por
 * pesos. El resto de la ficha —fotos, corredora, m², dirección— se guarda
 * entero, que es lo que se estaba perdiendo.
 */
const MONEDAS_SOPORTADAS = new Set(['CLP', 'UF'])

function normalizarMoneda(currency) {
  return MONEDAS_SOPORTADAS.has(currency) ? currency : 'CLP'
}

async function resolveComunaId(client, comunaRaw) {
  if (!comunaRaw) return { comunaId: null, localidad: null }
  const { comuna, localidad } = normalizeComuna(comunaRaw)
  if (!comuna) return { comunaId: null, localidad: null }
  const { rows } = await client.query(`SELECT id FROM chile_comunas WHERE name = $1`, [comuna.name])
  return { comunaId: rows[0]?.id ?? null, localidad: localidad ?? null }
}

/**
 * Decide el `change_type` más significativo entre la fila existente y los
 * datos nuevos. Un solo valor por fila (limitación del enum de 0034) — se
 * prioriza lo más operativamente relevante: reactivación > cambio de
 * corredora > cambio de precio > actualización genérica. `null` si nada
 * relevante cambió (no se escribe fila en listing_version_log_cl).
 */
/**
 * ¿Cambió el precio DE VERDAD? Se compara el precio tal cual lo publica el
 * anuncio, no el normalizado a CLP.
 *
 * `price` (CLP) de un anuncio en UF es un valor DERIVADO: price_uf × la tasa UF
 * del día. La UF sube casi a diario, así que comparar CLP marcaba "cambio de
 * precio" en todos los anuncios en UF cada vez que se refrescaban, sin que el
 * vendedor tocara nada. Medido en producción: 1.979 cambios de precio en 24h,
 * la inmensa mayoría falsos — justo el dato que sirve para detectar rebajas
 * reales, ahogado en ruido.
 */
function precioCambio(existing, next) {
  const enUf = (existing.currency ?? next.currency) === 'UF'
  if (enUf) {
    // Si el anuncio está en UF, manda el UF publicado. Sin dato previo de UF
    // (filas viejas) no se puede afirmar que cambió: no se marca.
    if (existing.price_uf == null || next.price_uf == null) return false
    return Number(existing.price_uf) !== Number(next.price_uf)
  }
  if (existing.price == null || next.price == null) return false
  return Number(existing.price) !== Number(next.price)
}

function detectChangeType(existing, next) {
  if (!existing) return 'new'

  const wasGone = existing.status === 'gone' || existing.is_active === false
  if (wasGone && next.is_active !== false) return 'reactivated'

  if (existing.advertiser_name && next.advertiser_name && existing.advertiser_name !== next.advertiser_name) {
    return 'agency_change'
  }

  if (precioCambio(existing, next)) return 'price_change'

  const photosCountBefore = Array.isArray(existing.photos) ? existing.photos.length : (existing.photos?.length ?? 0)
  const photosCountAfter = Array.isArray(next.photos) ? next.photos.length : 0
  const somethingElseChanged =
    photosCountBefore !== photosCountAfter ||
    Boolean(existing.has_video) !== Boolean(next.has_video) ||
    existing.description !== next.description ||
    existing.square_meters !== next.square_meters ||
    existing.bedrooms !== next.bedrooms ||
    existing.bathrooms !== next.bathrooms

  return somethingElseChanged ? 'updated' : null
}

/**
 * Upsert de un anuncio parseado. Devuelve { listingId, changeType, snapshot }.
 *
 * @param {import('pg').Client} client
 * @param {object} parsed - salida de parseDetailPage() (parse-portalinmobiliario.mjs)
 * @param {{ ufRate?: number, ufRateDate?: string, scrapedAt?: Date }} [options]
 */
export async function upsertListingCl(client, parsed, options = {}) {
  const { ufRate = null, ufRateDate = null, scrapedAt = new Date() } = options

  const { rows: existingRows } = await client.query(
    `SELECT id, price, price_uf, currency, advertiser_name, photos, description, square_meters, bedrooms, bathrooms, status, is_active, has_video
     FROM listings_cl WHERE portal = $1 AND external_id = $2`,
    [parsed.portal ?? 'portalinmobiliario', parsed.external_id]
  )
  const existing = existingRows[0] ?? null

  const { comunaId, localidad } = await resolveComunaId(client, parsed.comuna)
  // Ojo al orden: el precio se resuelve con la moneda TAL CUAL la publicó el
  // anuncio, para que una moneda no soportada dé null en vez de colarse como
  // pesos. La normalización a un valor que el CHECK acepte va después.
  const priceClp = resolvePriceClp(parsed, ufRate)
  const priceUf = resolvePriceUf(parsed)
  const currency = normalizarMoneda(parsed.currency)

  // Antigüedad REAL del aviso según el portal (parsed.posted_days_ago, desde el
  // subtitle de la ficha) — first_seen_at mide cuándo NOSOTROS lo vimos, que
  // puede ser mucho más tarde si el discovery recién llegó a esta comuna.
  const portalFirstSeenAt = Number.isFinite(parsed.posted_days_ago)
    ? new Date(scrapedAt.getTime() - parsed.posted_days_ago * 86400000)
    : null

  const next = {
    price: priceClp,
    price_uf: priceUf,
    currency,
    advertiser_name: parsed.advertiser_name ?? null,
    photos: parsed.photos ?? [],
    description: parsed.description ?? null,
    square_meters: parsed.square_meters ?? null,
    bedrooms: parsed.bedrooms ?? null,
    bathrooms: parsed.bathrooms ?? null,
    has_video: parsed.has_video ?? false,
    is_active: true, // solo llegamos aquí si la ficha SÍ se pudo fetch/parsear ahora
  }

  const changeType = detectChangeType(existing, next)

  const { rows: upserted } = await client.query(
    `INSERT INTO listings_cl (
       portal, source_type, external_id, source_url, operation, advertiser_type, advertiser_name, phone,
       price, price_uf, uf_rate, uf_rate_date, currency, bedrooms, bathrooms, square_meters, property_type,
       comuna_id, comuna_raw, localidad, address, latitude, longitude, description, photos,
       property_code, advertiser_id, seller_reference, features, has_video, video_modal_url, advertiser_logo,
       portal_first_seen_at,
       status, is_active, last_seen_at, detail_parsed_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       $18,$19,$20,$21,$22,$23,$24,$25,
       $26,$27,$28,$30,$31,$32,$33,$34,
       'active', true, $29, $29, now()
     )
     ON CONFLICT (portal, external_id) DO UPDATE SET
       source_type = EXCLUDED.source_type, source_url = EXCLUDED.source_url,
       operation = EXCLUDED.operation, advertiser_type = EXCLUDED.advertiser_type,
       advertiser_name = EXCLUDED.advertiser_name, phone = EXCLUDED.phone,
       price = EXCLUDED.price, price_uf = EXCLUDED.price_uf, uf_rate = EXCLUDED.uf_rate,
       uf_rate_date = EXCLUDED.uf_rate_date, currency = EXCLUDED.currency,
       bedrooms = EXCLUDED.bedrooms, bathrooms = EXCLUDED.bathrooms, square_meters = EXCLUDED.square_meters,
       property_type = EXCLUDED.property_type, comuna_id = EXCLUDED.comuna_id, comuna_raw = EXCLUDED.comuna_raw,
       localidad = EXCLUDED.localidad, address = EXCLUDED.address, latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude, description = EXCLUDED.description, photos = EXCLUDED.photos,
       property_code = EXCLUDED.property_code, advertiser_id = EXCLUDED.advertiser_id,
       seller_reference = EXCLUDED.seller_reference, features = EXCLUDED.features,
       has_video = EXCLUDED.has_video, video_modal_url = EXCLUDED.video_modal_url,
       advertiser_logo = EXCLUDED.advertiser_logo,
       -- COALESCE: si esta pasada no pudo parsear "hace N días" (subtitle
       -- cambió de forma, o vino null), no se pisa un valor ya bueno con null.
       portal_first_seen_at = COALESCE(EXCLUDED.portal_first_seen_at, listings_cl.portal_first_seen_at),
       -- Marca de que ESTA ficha se bajó y parseó entera con el parser actual.
       -- Distinto de last_seen_at, que también lo mueve el barrido del listado:
       -- es lo que permite rotar el re-scrapeo por antigüedad real de la ficha
       -- sin repetir siempre las mismas (ver queue-maintenance-cl.mjs).
       detail_parsed_at = EXCLUDED.detail_parsed_at,
       status = 'active', is_active = true, last_seen_at = EXCLUDED.last_seen_at, updated_at = now()
     RETURNING id`,
    [
      parsed.portal ?? 'portalinmobiliario', parsed.source_type ?? 'portal', parsed.external_id, parsed.source_url,
      parsed.operation ?? null, parsed.advertiser_type ?? 'unknown', parsed.advertiser_name ?? null, parsed.phone ?? null,
      priceClp, priceUf, ufRate, ufRateDate, currency, parsed.bedrooms ?? null, parsed.bathrooms ?? null,
      parsed.square_meters ?? null, parsed.property_type ?? null,
      comunaId, parsed.comuna ?? null, localidad, parsed.address ?? null, parsed.latitude ?? null, parsed.longitude ?? null,
      parsed.description ?? null, JSON.stringify(parsed.photos ?? []),
      parsed.property_code ?? null, parsed.advertiser_id ?? null, parsed.seller_reference ?? null,
      scrapedAt,
      JSON.stringify(parsed.features ?? []),
      parsed.has_video ?? false, parsed.video_modal_url ?? null, parsed.advertiser_logo ?? null,
      portalFirstSeenAt,
    ]
  )
  const listingId = upserted[0].id

  if (changeType) {
    await client.query(
      `INSERT INTO listing_version_log_cl (
         listing_id, scraped_at, change_type, price_before, price_after,
         photos_count_before, photos_count_after, agency_before, agency_after
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (listing_id, scraped_at) DO NOTHING`,
      [
        listingId, scrapedAt, changeType,
        existing?.price ?? null, next.price,
        existing?.photos?.length ?? null, next.photos.length,
        existing?.advertiser_name ?? null, next.advertiser_name,
      ]
    )
  }

  const snapshot = await recordSnapshotCl(client, listingId, parsed, scrapedAt)

  return { listingId, changeType, snapshot }
}
