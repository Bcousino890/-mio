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
import { resolvePriceClp, resolvePriceUf, resolvePriceUsd } from './to-listing.mjs'
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
const MONEDAS_SOPORTADAS = new Set(['CLP', 'UF', 'USD'])

function normalizarMoneda(currency) {
  return MONEDAS_SOPORTADAS.has(currency) ? currency : 'CLP'
}

/**
 * Qué set de fotos se guarda: el recién bajado o el que ya había.
 *
 * El modal de galería del portal responde de forma inconsistente. Verificado en
 * vivo sobre MLC-4014327318: teníamos 14 fotos guardadas y tres peticiones
 * seguidas al modal devolvieron 9 — no un error, un 200 con menos fotos. Como
 * el upsert hacía `photos = EXCLUDED.photos` sin condiciones, el siguiente
 * re-scrapeo habría reemplazado 14 fotos buenas por 9. Y con la rotación
 * pasando por todo el catálogo, eso ocurriría tarde o temprano en cualquier
 * ficha: cada respuesta floja del portal borraba fotos para siempre.
 *
 * Se acepta el set nuevo si NO encoge, o si trae todas las que el portal
 * declara ahora — ese segundo caso es el que permite reflejar que el vendedor
 * borró fotos de verdad, en vez de quedarse con URLs muertas. Si encoge sin
 * llegar al total declarado, es una respuesta parcial: se conserva lo que había.
 */
function fotosAGuardar(existing, parsed) {
  const nuevas = parsed.photos ?? []
  const guardadas = Array.isArray(existing?.photos) ? existing.photos : []
  if (guardadas.length === 0) return nuevas
  if (nuevas.length >= guardadas.length) return nuevas

  const declaradas = parsed.photos_total_count
  if (declaradas != null && nuevas.length >= declaradas) return nuevas

  return guardadas
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
  const moneda = existing.currency ?? next.currency
  // El importe PUBLICADO manda, sea cual sea la moneda. Vale igual para el
  // dólar que para la UF: `price` (CLP) también se deriva de la tasa del día,
  // así que compararlo marcaría rebajas falsas cada vez que se mueve el cambio.
  const publicado = moneda === 'UF' ? 'price_uf' : moneda === 'USD' ? 'price_usd' : null
  if (publicado) {
    // Sin dato previo del importe publicado (filas viejas) no se puede afirmar
    // que cambió: no se marca.
    if (existing[publicado] == null || next[publicado] == null) return false
    return Number(existing[publicado]) !== Number(next[publicado])
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
 * @param {{ ufRate?: number, ufRateDate?: string, usdRate?: number, usdRateDate?: string, scrapedAt?: Date }} [options]
 */
export async function upsertListingCl(client, parsed, options = {}) {
  const { ufRate = null, ufRateDate = null, usdRate = null, usdRateDate = null, scrapedAt = new Date() } = options

  const { rows: existingRows } = await client.query(
    `SELECT id, price, price_uf, price_usd, currency, advertiser_name, photos, description, square_meters, bedrooms, bathrooms, status, is_active, has_video
     FROM listings_cl WHERE portal = $1 AND external_id = $2`,
    [parsed.portal ?? 'portalinmobiliario', parsed.external_id]
  )
  const existing = existingRows[0] ?? null

  const { comunaId, localidad } = await resolveComunaId(client, parsed.comuna)
  // Ojo al orden: el precio se resuelve con la moneda TAL CUAL la publicó el
  // anuncio, para que una moneda no soportada dé null en vez de colarse como
  // pesos. La normalización a un valor que el CHECK acepte va después.
  const priceClp = resolvePriceClp(parsed, ufRate, usdRate)
  const priceUf = resolvePriceUf(parsed)
  const priceUsd = resolvePriceUsd(parsed)
  const currency = normalizarMoneda(parsed.currency)
  // Una respuesta parcial del modal de galería no puede borrar fotos buenas.
  const photos = fotosAGuardar(existing, parsed)

  // Antigüedad REAL del aviso según el portal (parsed.posted_days_ago, desde el
  // subtitle de la ficha) — first_seen_at mide cuándo NOSOTROS lo vimos, que
  // puede ser mucho más tarde si el discovery recién llegó a esta comuna.
  const portalFirstSeenAt = Number.isFinite(parsed.posted_days_ago)
    ? new Date(scrapedAt.getTime() - parsed.posted_days_ago * 86400000)
    : null

  const next = {
    price: priceClp,
    price_uf: priceUf,
    price_usd: priceUsd,
    currency,
    advertiser_name: parsed.advertiser_name ?? null,
    photos,
    description: parsed.description ?? null,
    square_meters: parsed.square_meters ?? null,
    bedrooms: parsed.bedrooms ?? null,
    bathrooms: parsed.bathrooms ?? null,
    has_video: parsed.has_video ?? false,
    is_active: true, // solo llegamos aquí si la ficha SÍ se pudo fetch/parsear ahora
  }

  const changeType = detectChangeType(existing, next)

  // Los placeholders van en ORDEN ESTRICTO, uno por columna y en la misma
  // secuencia que la lista de columnas. No es cosmético: cuando se añadieron
  // price_usd/usd_rate/usd_rate_date a la lista, sus valores se engancharon al
  // final ($36,$37,$38) y el resto de la secuencia quedó descolocada — usd_rate
  // acababa recibiendo la FECHA de la tasa UF y Postgres rechazaba la fila
  // entera con 'invalid input syntax for type numeric'. Efecto en producción:
  // desde el minuto en que se desplegó, NINGUNA ficha volvió a guardarse. Con la
  // numeración correlativa, añadir una columna es añadir su valor en la misma
  // posición del array, y un descuadre se ve a simple vista.
  const { rows: upserted } = await client.query(
    `INSERT INTO listings_cl (
       portal, source_type, external_id, source_url, operation, advertiser_type, advertiser_name, phone,
       price, price_uf, price_usd, usd_rate, usd_rate_date, uf_rate, uf_rate_date, currency, bedrooms, bathrooms, square_meters, property_type,
       comuna_id, comuna_raw, localidad, address, latitude, longitude, description, photos, photos_total_count,
       property_code, advertiser_id, seller_reference, features, has_video, video_modal_url, advertiser_logo,
       portal_first_seen_at, parser_version,
       status, is_active, last_seen_at, detail_parsed_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
       'active', true, $39, $39, now()
     )
     ON CONFLICT (portal, external_id) DO UPDATE SET
       source_type = EXCLUDED.source_type, source_url = EXCLUDED.source_url,
       operation = EXCLUDED.operation, advertiser_type = EXCLUDED.advertiser_type,
       advertiser_name = EXCLUDED.advertiser_name, phone = EXCLUDED.phone,
       price = EXCLUDED.price, price_uf = EXCLUDED.price_uf, price_usd = EXCLUDED.price_usd,
       usd_rate = EXCLUDED.usd_rate, usd_rate_date = EXCLUDED.usd_rate_date, uf_rate = EXCLUDED.uf_rate,
       uf_rate_date = EXCLUDED.uf_rate_date, currency = EXCLUDED.currency,
       bedrooms = EXCLUDED.bedrooms, bathrooms = EXCLUDED.bathrooms, square_meters = EXCLUDED.square_meters,
       property_type = EXCLUDED.property_type, comuna_id = EXCLUDED.comuna_id, comuna_raw = EXCLUDED.comuna_raw,
       localidad = EXCLUDED.localidad, address = EXCLUDED.address, latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude, description = EXCLUDED.description, photos = EXCLUDED.photos,
       -- COALESCE: si esta pasada no pudo leer el total declarado, no se pisa
       -- con null un valor bueno — sin él no se puede saber si faltan fotos.
       photos_total_count = COALESCE(EXCLUDED.photos_total_count, listings_cl.photos_total_count),
       -- Sube siempre que se re-lea la ficha (nunca en falso: solo se llega
       -- aquí tras un parseo que sí devolvió datos), así que no hace falta
       -- COALESCE: pisar con la versión actual es justo el objetivo.
       parser_version = EXCLUDED.parser_version,
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
    // Un valor por columna, en el MISMO orden que la lista de columnas del
    // INSERT. Los comentarios de posición no son decoración: son lo que hace
    // que añadir una columna en medio no vuelva a descuadrar la fila entera.
    [
      /*  1 portal              */ parsed.portal ?? 'portalinmobiliario',
      /*  2 source_type         */ parsed.source_type ?? 'portal',
      /*  3 external_id         */ parsed.external_id,
      /*  4 source_url          */ parsed.source_url,
      /*  5 operation           */ parsed.operation ?? null,
      /*  6 advertiser_type     */ parsed.advertiser_type ?? 'unknown',
      /*  7 advertiser_name     */ parsed.advertiser_name ?? null,
      /*  8 phone               */ parsed.phone ?? null,
      /*  9 price               */ priceClp,
      /* 10 price_uf            */ priceUf,
      /* 11 price_usd           */ priceUsd,
      /* 12 usd_rate            */ usdRate,
      /* 13 usd_rate_date       */ usdRateDate,
      /* 14 uf_rate             */ ufRate,
      /* 15 uf_rate_date        */ ufRateDate,
      /* 16 currency            */ currency,
      /* 17 bedrooms            */ parsed.bedrooms ?? null,
      /* 18 bathrooms           */ parsed.bathrooms ?? null,
      /* 19 square_meters       */ parsed.square_meters ?? null,
      /* 20 property_type       */ parsed.property_type ?? null,
      /* 21 comuna_id           */ comunaId,
      /* 22 comuna_raw          */ parsed.comuna ?? null,
      /* 23 localidad           */ localidad,
      /* 24 address             */ parsed.address ?? null,
      /* 25 latitude            */ parsed.latitude ?? null,
      /* 26 longitude           */ parsed.longitude ?? null,
      /* 27 description         */ parsed.description ?? null,
      /* 28 photos              */ JSON.stringify(photos),
      /* 29 photos_total_count  */ parsed.photos_total_count ?? null,
      /* 30 property_code       */ parsed.property_code ?? null,
      /* 31 advertiser_id       */ parsed.advertiser_id ?? null,
      /* 32 seller_reference    */ parsed.seller_reference ?? null,
      /* 33 features            */ JSON.stringify(parsed.features ?? []),
      /* 34 has_video           */ parsed.has_video ?? false,
      /* 35 video_modal_url     */ parsed.video_modal_url ?? null,
      /* 36 advertiser_logo     */ parsed.advertiser_logo ?? null,
      /* 37 portal_first_seen_at*/ portalFirstSeenAt,
      /* 38 parser_version      */ parsed.parser_version ?? null,
      /* 39 last_seen_at + detail_parsed_at */ scrapedAt,
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
