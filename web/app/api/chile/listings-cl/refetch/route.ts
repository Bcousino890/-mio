import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { fetchListingPage } from '@/lib/captar-pipeline'
import { parsePortalListingDetail } from '@/lib/parse-portalinmobiliario-cl'
import { fetchPortalInmobiliarioGallery } from '@/lib/fetch-portalinmobiliario-gallery'
import { getUfRateCl } from '@/lib/uf-rate-cl'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chile/listings-cl/refetch — body: { id: <listings_cl.id> }
//
// Re-scrapea UN aviso puntual bajo demanda (botón "Re-scrapear" de la ficha en
// /chile/propiedades) en vez de esperar al próximo barrido programado de
// scrape_targets_cl (que es a nivel comuna+tipo+operación, ver
// anuncios-health/route.ts). Reusa el mismo parser que /api/chile/parse-listing
// pero, a diferencia de ese endpoint (solo análisis, no persiste), aquí SÍ se
// actualiza la fila existente de listings_cl.
//
// Solo pisa columnas que el parser efectivamente devolvió (COALESCE con el
// valor actual) — un fetch parcial (portal cambió de layout, bloqueo puntual)
// no debe borrar datos buenos ya guardados.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const { id } = await request.json()
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ success: false, error: 'Falta id' }, { status: 400 })
    }

    const { rows } = await pool.query(
      `SELECT id, source_url FROM listings_cl WHERE id = $1`,
      [id],
    )
    const listing = rows[0]
    if (!listing) {
      return NextResponse.json({ success: false, error: 'Aviso no encontrado' }, { status: 404 })
    }

    let html: string
    try {
      html = await fetchListingPage(listing.source_url)
    } catch (e) {
      return NextResponse.json({ success: false, error: `No se pudo descargar el aviso: ${e instanceof Error ? e.message : 'error'}` }, { status: 502 })
    }

    const detail = parsePortalListingDetail(html)
    if (!detail) {
      return NextResponse.json({ success: false, error: 'No se pudo interpretar el aviso (¿cambió el portal?)' }, { status: 422 })
    }

    let photos = detail.photos
    if (detail.gallery_url) {
      const galleryPhotos = await fetchPortalInmobiliarioGallery(detail.gallery_url)
      const seen = new Set(photos)
      for (const p of galleryPhotos) if (!seen.has(p)) { photos.push(p); seen.add(p) }
    }
    photos = photos.slice(0, 40)

    let price: number | null = null
    let priceUf: number | null = null
    let ufRate: number | null = null
    let ufRateDate: string | null = null
    if (detail.price != null) {
      if (detail.currency === 'UF') {
        priceUf = detail.price
        const rate = await getUfRateCl()
        if (rate) { price = Math.round(priceUf * rate.rate); ufRate = rate.rate; ufRateDate = rate.date }
      } else {
        price = detail.price
      }
    }

    const { rows: updated } = await pool.query(
      `UPDATE listings_cl SET
         operation = COALESCE($2, operation),
         property_type = COALESCE($3, property_type),
         price = COALESCE($4, price),
         price_uf = CASE WHEN $4::int IS NOT NULL THEN $5 ELSE price_uf END,
         uf_rate = CASE WHEN $4::int IS NOT NULL THEN COALESCE($6, uf_rate) ELSE uf_rate END,
         uf_rate_date = CASE WHEN $4::int IS NOT NULL THEN COALESCE($7::date, uf_rate_date) ELSE uf_rate_date END,
         currency = COALESCE($8, currency),
         bedrooms = COALESCE($9, bedrooms),
         bathrooms = COALESCE($10, bathrooms),
         square_meters = COALESCE($11, square_meters),
         address = COALESCE($12, address),
         description = COALESCE($13, description),
         photos = CASE WHEN $14::jsonb IS NOT NULL AND jsonb_array_length($14::jsonb) > 0 THEN $14::jsonb ELSE photos END,
         advertiser_name = COALESCE($15, advertiser_name),
         latitude = COALESCE($16, latitude),
         longitude = COALESCE($17, longitude),
         is_active = true,
         status = 'active',
         last_seen_at = now(),
         updated_at = now()
       WHERE id = $1
       RETURNING id, price, price_uf, currency, photos, last_seen_at`,
      [
        id, detail.operation, detail.property_type, price, priceUf, ufRate, ufRateDate,
        detail.currency, detail.bedrooms, detail.bathrooms, detail.square_meters,
        detail.address, detail.description, JSON.stringify(photos), detail.advertiser_name,
        detail.latitude, detail.longitude,
      ],
    )

    return NextResponse.json({ success: true, data: updated[0] })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}
