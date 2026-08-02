// scrape-listing-cl.ts — scraping PUNTUAL (on-demand) de una ficha para el
// buscador de /chile/propiedades: cuando alguien busca por código o pega una
// URL y no hay nada en la base todavía, se trae la ficha en vivo, se guarda en
// listings_cl (mismas columnas que el barrido masivo, ver
// scraper/lib/upsert-listing-cl.mjs) y se enlaza a su property_cl.
//
// Cubre las dos procedencias que se pegan en ese campo:
//   - Portal Inmobiliario (`scrapeAndUpsertListingCl`), con el mismo fetch/
//     parse ya probado en producción por /api/chile/captar y
//     /api/chile/parse-listing (fetchListingPage + parsePortalListingDetail); y
//   - la web propia de una corredora (`scrapeAndUpsertAgencyWebListing`), con
//     el parser genérico de parse-agency-web-cl.ts.
// `scrapeFromQuery` es el punto de entrada que elige entre las dos.
//
// No depende del proceso `scraper/` ni de colas.
import { pool } from '@/lib/db'
import { fetchListingPage, fetchListingPageVia, resolveComunaAsync } from '@/lib/captar-pipeline'
import { parsePortalListingDetail } from '@/lib/parse-portalinmobiliario-cl'
import { parseAgencyWebListing } from '@/lib/parse-agency-web-cl'
import { fetchTodasLasFotos } from '@/lib/fetch-portalinmobiliario-gallery'
import { getUfRateCl } from '@/lib/uf-rate-cl'
import { linkSingleListingToPropertyCl } from '@/lib/dedup-cl'
import { parsePropertyCodeQuery } from '@/lib/property-code-query'

// El MLC-id se extrae con el mismo parser que usa el buscador (ver
// property-code-query.ts): así "2107783039" a secas, "MLC-2107783039" y la URL
// larga con slug del navegador se resuelven todos al mismo anuncio.
export { extractMlcId } from '@/lib/property-code-query'

const MONEDAS_SOPORTADAS = new Set(['CLP', 'UF'])

function resolvePriceClp(price: number | null, currency: string | null, ufRate: number | null): number | null {
  if (price == null) return null
  if (currency === 'UF') return ufRate != null ? Math.round(price * ufRate) : null
  if (currency != null && currency !== 'CLP') return null
  return Math.round(price)
}

function resolvePriceUf(price: number | null, currency: string | null): number | null {
  return currency === 'UF' ? price : null
}

export type ScrapeResult =
  | { ok: true; propertyId: string }
  | { ok: false; error: string }

/**
 * Scrapea una ficha de Portal Inmobiliario a partir de un código/URL,
 * la guarda en listings_cl (upsert por `(portal, external_id)`, igual que el
 * barrido masivo) y la enlaza a su property_cl. Idempotente: repetir con el
 * mismo código actualiza la misma fila en vez de duplicarla.
 */
export async function scrapeAndUpsertListingCl(query: string): Promise<ScrapeResult> {
  const consulta = parsePropertyCodeQuery(query)
  const externalId = consulta.mlcId
  if (!externalId) return { ok: false, error: 'No es un código ni una URL de Portal Inmobiliario reconocible' }

  // Si pegaron la URL del navegador se usa esa (ya sin `?`/`#`); si escribieron
  // solo el código, se arma la URL canónica del anuncio.
  const url = consulta.listingUrl ?? `https://www.portalinmobiliario.com/${externalId}`

  let html: string
  try {
    html = await fetchListingPage(url)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `No se pudo descargar el anuncio: ${e.message}` : 'No se pudo descargar el anuncio' }
  }

  const parsed = parsePortalListingDetail(html)
  if (!parsed) return { ok: false, error: 'No se pudo interpretar el contenido del anuncio (¿la publicación ya no existe?)' }

  // Fotos completas: el blob de la ficha sirve como mucho 5, así que hay que
  // pedir además el modal de galería (y, si sigue corto, el modal por item id).
  const photos = await fetchTodasLasFotos({
    delBlob: parsed.photos,
    galleryUrl: parsed.gallery_url,
    externalId,
    esperadas: parsed.photos_total_count ?? null,
  })

  const comunaMatch = await resolveComunaAsync(parsed.comuna)
  let comunaId: string | null = null
  if (comunaMatch?.label) {
    const { rows } = await pool.query(`SELECT id FROM chile_comunas WHERE name = $1`, [comunaMatch.label])
    comunaId = rows[0]?.id ?? null
  }

  const uf = await getUfRateCl().catch(() => null)
  const currency = MONEDAS_SOPORTADAS.has(parsed.currency ?? '') ? parsed.currency : 'CLP'
  const priceClp = resolvePriceClp(parsed.price, parsed.currency, uf?.rate ?? null)
  const priceUf = resolvePriceUf(parsed.price, parsed.currency)
  const sourceUrl = `https://www.portalinmobiliario.com/${externalId}`

  const { rows: upserted } = await pool.query(
    `INSERT INTO listings_cl (
       portal, source_type, external_id, source_url, operation, advertiser_type, advertiser_name,
       price, price_uf, uf_rate, uf_rate_date, currency, bedrooms, bathrooms, square_meters, property_type,
       comuna_id, comuna_raw, address, latitude, longitude, description, photos, photos_total_count,
       property_code, advertiser_id, seller_reference, has_video, video_modal_url, advertiser_logo,
       status, is_active, last_seen_at, detail_parsed_at, updated_at
     ) VALUES (
       'portalinmobiliario','portal',$1,$2,$3,$4,$5,
       $6,$7,$8,$9,$10,$11,$12,$13,$14,
       $15,$16,$17,$18,$19,$20,$21,$22,
       $23,$24,$25,$26,$27,$28,
       'active', true, now(), now(), now()
     )
     ON CONFLICT (portal, external_id) DO UPDATE SET
       source_url = EXCLUDED.source_url, operation = EXCLUDED.operation,
       advertiser_type = EXCLUDED.advertiser_type, advertiser_name = EXCLUDED.advertiser_name,
       price = EXCLUDED.price, price_uf = EXCLUDED.price_uf, uf_rate = EXCLUDED.uf_rate,
       uf_rate_date = EXCLUDED.uf_rate_date, currency = EXCLUDED.currency,
       bedrooms = EXCLUDED.bedrooms, bathrooms = EXCLUDED.bathrooms, square_meters = EXCLUDED.square_meters,
       property_type = EXCLUDED.property_type, comuna_id = EXCLUDED.comuna_id, comuna_raw = EXCLUDED.comuna_raw,
       address = EXCLUDED.address, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
       description = EXCLUDED.description, photos = EXCLUDED.photos,
       photos_total_count = COALESCE(EXCLUDED.photos_total_count, listings_cl.photos_total_count),
       property_code = EXCLUDED.property_code, advertiser_id = EXCLUDED.advertiser_id,
       seller_reference = EXCLUDED.seller_reference, has_video = EXCLUDED.has_video,
       video_modal_url = EXCLUDED.video_modal_url, advertiser_logo = EXCLUDED.advertiser_logo,
       detail_parsed_at = now(), status = 'active', is_active = true, last_seen_at = now(), updated_at = now()
     RETURNING id`,
    [
      externalId, sourceUrl, parsed.operation, parsed.advertiser_type ?? 'unknown', parsed.advertiser_name,
      priceClp, priceUf, uf?.rate ?? null, uf?.date ?? null, currency, parsed.bedrooms, parsed.bathrooms,
      parsed.square_meters, parsed.property_type,
      comunaId, parsed.comuna, parsed.address, parsed.latitude, parsed.longitude, parsed.description,
      JSON.stringify(photos), parsed.photos_total_count ?? (photos.length || null),
      parsed.property_code, parsed.advertiser_id, parsed.seller_reference, parsed.has_video, parsed.video_modal_url,
      parsed.advertiser_logo,
    ]
  )
  const listingId = upserted[0].id as string

  const propertyId = await linkSingleListingToPropertyCl(pool, listingId)
  return { ok: true, propertyId }
}

// ─── Web propia de una corredora ─────────────────────────────────────────────
// Lo de arriba solo sabe de Portal Inmobiliario. Pero en el buscador se pega
// también la URL de la ficha en la web de la corredora, y esas no las cubre el
// barrido salvo que su dominio esté dado de alta en corredora_web_targets_cl.
// Aquí se trae UNA url suelta con el mismo parseo que usa el crawler.

// Descargar una URL que escribe el usuario es pedirle al servidor que haga una
// petición en su nombre, así que antes se comprueba que apunte de verdad a
// Internet: sin esto, pegar `http://localhost:5432` o una IP de la red privada
// convierte el buscador en una ventana a la infraestructura interna. Es una
// comprobación de hostname (no resuelve DNS): suficiente contra el pegado
// accidental o curioso, que es el riesgo real en un CRM interno.
const HOSTS_PRIVADOS = [
  /^localhost$/i,
  /^127\./, /^0\./, /^10\./, /^192\.168\./, /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/, /^\[?f[cd][0-9a-f]{2}:/i,
  /\.local$/i, /\.internal$/i,
]

export function esUrlPublica(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const host = u.hostname
  // Un host sin punto no es un dominio de Internet, es un nombre de la red
  // local (`intranet`, `db`, el nombre de un contenedor…).
  if (!host.includes('.') && !host.includes(':')) return false
  return !HOSTS_PRIVADOS.some(re => re.test(host))
}

/**
 * Trae la ficha de la web propia de una corredora a partir de su URL, la guarda
 * en listings_cl (`source_type = 'agency_web'`, igual que crawl-corredora-web-cl)
 * y la enlaza a su property_cl. Idempotente por `(portal, external_id)`: repetir
 * la misma URL actualiza la fila en vez de duplicarla.
 */
export async function scrapeAndUpsertAgencyWebListing(url: string): Promise<ScrapeResult> {
  if (!esUrlPublica(url)) {
    return { ok: false, error: 'La dirección no es una URL pública de un sitio web' }
  }

  // Sin proxy: son sitios pequeños sin anti-bot, y el fetch directo es el que
  // funciona contra estos dominios (mismo criterio que el crawler 24/7).
  let html: string
  try {
    const res = await fetchListingPageVia(url, null)
    if (res.status !== 200) return { ok: false, error: `La página respondió HTTP ${res.status}` }
    html = res.html
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `No se pudo descargar la página: ${e.message}` : 'No se pudo descargar la página' }
  }

  const ficha = parseAgencyWebListing(html, url)
  if (!ficha) {
    return {
      ok: false,
      error: 'No se pudo interpretar la página como una ficha de propiedad (¿es un listado, o la carga por JavaScript?)',
    }
  }

  const comunaMatch = await resolveComunaAsync(ficha.comuna)
  let comunaId: string | null = null
  if (comunaMatch?.label) {
    const { rows } = await pool.query(`SELECT id FROM chile_comunas WHERE name = $1`, [comunaMatch.label])
    comunaId = rows[0]?.id ?? null
  }

  // El precio se guarda SIEMPRE en pesos, con la UF del día si la ficha estaba
  // en UF: es lo que hace comparable esta fila con las del portal (el dedup y
  // el orden por precio miran `price`).
  const uf = await getUfRateCl().catch(() => null)
  const priceClp = resolvePriceClp(ficha.price ?? ficha.price_uf, ficha.currency, uf?.rate ?? null)

  const { rows: upserted } = await pool.query(
    `INSERT INTO listings_cl (
       portal, source_type, external_id, source_url, operation, advertiser_type, advertiser_name,
       price, price_uf, uf_rate, uf_rate_date, currency, bedrooms, bathrooms, square_meters, property_type,
       comuna_id, comuna_raw, description, photos, photos_total_count, seller_reference,
       status, is_active, last_seen_at, detail_parsed_at, updated_at
     -- El anunciante va como 'professional', no 'agency': el vocabulario de esa
     -- columna solo admite particular/professional/unknown (migración 0028), y
     -- una corredora publicando en su propia web es un profesional. Con
     -- 'agency' el CHECK de la tabla rechaza la fila y no se guarda nada.
     ) VALUES (
       $1,'agency_web',$2,$3,$4,'professional',$5,
       $6,$7,$8,$9,$10,$11,$12,$13,$14,
       $15,$16,$17,$18,$19,$20,
       'active', true, now(), now(), now()
     )
     ON CONFLICT (portal, external_id) DO UPDATE SET
       source_url = EXCLUDED.source_url, operation = EXCLUDED.operation,
       advertiser_name = EXCLUDED.advertiser_name,
       price = EXCLUDED.price, price_uf = EXCLUDED.price_uf, uf_rate = EXCLUDED.uf_rate,
       uf_rate_date = EXCLUDED.uf_rate_date, currency = EXCLUDED.currency,
       bedrooms = EXCLUDED.bedrooms, bathrooms = EXCLUDED.bathrooms, square_meters = EXCLUDED.square_meters,
       property_type = EXCLUDED.property_type, comuna_id = EXCLUDED.comuna_id, comuna_raw = EXCLUDED.comuna_raw,
       description = EXCLUDED.description, photos = EXCLUDED.photos,
       photos_total_count = COALESCE(EXCLUDED.photos_total_count, listings_cl.photos_total_count),
       seller_reference = EXCLUDED.seller_reference,
       detail_parsed_at = now(), status = 'active', is_active = true, last_seen_at = now(), updated_at = now()
     RETURNING id`,
    [
      ficha.portal, ficha.external_id, ficha.source_url, ficha.operation, ficha.title,
      priceClp, ficha.price_uf, uf?.rate ?? null, uf?.date ?? null, ficha.currency,
      ficha.bedrooms, ficha.bathrooms, ficha.square_meters, ficha.property_type,
      comunaId, ficha.comuna, ficha.description,
      JSON.stringify(ficha.photos), ficha.photos.length || null, ficha.seller_reference,
    ],
  )

  const propertyId = await linkSingleListingToPropertyCl(pool, upserted[0].id as string)
  return { ok: true, propertyId }
}

/**
 * Punto de entrada único del "si no está, se trae": decide por lo escrito si
 * hay que ir a Portal Inmobiliario o a la web de una corredora. Devuelve null
 * cuando lo escrito no da ninguna URL que descargar (un código interno suelto
 * no tiene dónde ir a buscarse).
 */
export async function scrapeFromQuery(query: string): Promise<ScrapeResult | null> {
  const consulta = parsePropertyCodeQuery(query)
  if (consulta.scrapeable) return scrapeAndUpsertListingCl(query)
  if (consulta.listingUrl) return scrapeAndUpsertAgencyWebListing(consulta.listingUrl)
  return null
}
