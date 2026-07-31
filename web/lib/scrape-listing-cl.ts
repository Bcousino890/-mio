// scrape-listing-cl.ts — scraping PUNTUAL (on-demand) de una ficha de
// Portal Inmobiliario para el buscador de /chile/propiedades: cuando alguien
// busca por código/URL y no hay nada en la base todavía, se trae la ficha en
// vivo, se guarda en listings_cl (mismas columnas que el barrido masivo, ver
// scraper/lib/upsert-listing-cl.mjs) y se enlaza a su property_cl.
//
// Reutiliza el mismo fetch/parse ya probado en producción por
// /api/chile/captar y /api/chile/parse-listing (fetchListingPage +
// parsePortalListingDetail) — no depende del proceso `scraper/` ni de colas.
import { pool } from '@/lib/db'
import { fetchListingPage, resolveComunaAsync } from '@/lib/captar-pipeline'
import { parsePortalListingDetail } from '@/lib/parse-portalinmobiliario-cl'
import { fetchPortalInmobiliarioGallery } from '@/lib/fetch-portalinmobiliario-gallery'
import { getUfRateCl } from '@/lib/uf-rate-cl'
import { linkSingleListingToPropertyCl } from '@/lib/dedup-cl'

/** Extrae el MLC-id normalizado (con guión, ej. "MLC-2009525691") de un
 * código suelto o de una URL completa de portalinmobiliario.com. */
export function extractMlcId(input: string): string | null {
  const m = input.match(/MLC-?(\d+)/i)
  return m ? `MLC-${m[1]}` : null
}

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
  const externalId = extractMlcId(query)
  if (!externalId) return { ok: false, error: 'No es un código ni una URL de Portal Inmobiliario reconocible' }

  const trimmed = query.trim()
  const url = /^https?:\/\//i.test(trimmed) || trimmed.includes('portalinmobiliario.com')
    ? trimmed.split('#')[0].split('?')[0]
    : `https://www.portalinmobiliario.com/${externalId}`

  let html: string
  try {
    html = await fetchListingPage(url)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `No se pudo descargar el anuncio: ${e.message}` : 'No se pudo descargar el anuncio' }
  }

  const parsed = parsePortalListingDetail(html)
  if (!parsed) return { ok: false, error: 'No se pudo interpretar el contenido del anuncio (¿la publicación ya no existe?)' }

  // Fotos completas del modal de galería, igual que /api/chile/captar — el
  // HTML estático solo trae ~5.
  const photos = [...parsed.photos]
  if (parsed.gallery_url) {
    try {
      const galleryPhotos = await fetchPortalInmobiliarioGallery(parsed.gallery_url)
      const seen = new Set(photos)
      for (const p of galleryPhotos) if (!seen.has(p)) { photos.push(p); seen.add(p) }
    } catch {
      // best-effort: la ficha se guarda igual con las fotos que sí se pudieron leer
    }
  }

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
