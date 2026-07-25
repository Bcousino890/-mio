import { NextRequest, NextResponse } from 'next/server'
import { extractFromSlug, fetchListingPage, findSiiCandidatesV3, resolveComunaAsync } from '@/lib/captar-pipeline'
import { parsePortalListingDetail } from '@/lib/parse-portalinmobiliario-cl'
import { fetchPortalInmobiliarioGallery } from '@/lib/fetch-portalinmobiliario-gallery'
import type { ParsedListing } from '@/lib/sii-match-cl-v2'

/**
 * POST /api/chile/parse-listing
 * body: { url: string }
 *
 * Análisis puntual (sin persistir): extrae los datos del anuncio de Portal
 * Inmobiliario y devuelve los roles SII candidatos puntuados. Para el flujo
 * completo con persistencia + TGR + DealerNet usar /api/chile/captar.
 */
export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json()
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ success: false, error: 'URL requerida' }, { status: 400 })
    }

    const slugInfo = extractFromSlug(url)
    const externalId = url.split('#')[0].split('?')[0].match(/MLC-?\d+/)?.[0]?.replace('MLC-', 'MLC') ?? null

    let parsed: Record<string, unknown> = {}
    let fetchError: string | null = null
    try {
      const html = await fetchListingPage(url)
      const detail = parsePortalListingDetail(html)
      if (detail) {
        // Fotos: además de las del blob estático + modal de galería, cae al
        // fallback por item_id (más fiable — ver fetch-portalinmobiliario-gallery.ts).
        let allPhotos = detail.photos
        if (detail.gallery_url || externalId) {
          const galleryPhotos = await fetchPortalInmobiliarioGallery(detail.gallery_url ?? '', externalId)
          // Combina fotos del HTML estático con las del modal (deduplicado)
          const seenPhotos = new Set(allPhotos)
          for (const photo of galleryPhotos) {
            if (!seenPhotos.has(photo)) {
              allPhotos.push(photo)
              seenPhotos.add(photo)
            }
          }
        }

        parsed = {
          title: detail.title,
          operation: detail.operation,
          property_type: detail.property_type,
          price_raw: detail.price,
          currency: detail.currency,
          sqm: detail.square_meters,
          bedrooms: detail.bedrooms,
          bathrooms: detail.bathrooms,
          lat: detail.latitude,
          lng: detail.longitude,
          address: detail.address,
          address_full: detail.address && detail.comuna ? `${detail.address}, ${detail.comuna}` : detail.address,
          advertiser_name: detail.advertiser_name,
          advertiser_type: detail.advertiser_type,
          photos: allPhotos.slice(0, 40),
          photos_total_count: detail.photos_total_count,
          description: detail.description,
          comuna_detected: detail.comuna,
        }
      } else {
        fetchError = 'No se pudo interpretar el contenido del anuncio'
      }
    } catch (e) {
      fetchError = e instanceof Error ? e.message : 'Error fetching URL'
    }

    const comunaMatch = (await resolveComunaAsync((parsed.comuna_detected as string) ?? null))
      ?? (await resolveComunaAsync((slugInfo?.raw_slug as string) ?? null))
      ?? (slugInfo
        ? { siiCode: slugInfo.sii_code as string, label: slugInfo.comuna_label as string, slug: slugInfo.comuna_slug as string }
        : null)

    const merged: Record<string, unknown> = {
      ...slugInfo,
      ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== null && v !== undefined)),
      sii_code: comunaMatch?.siiCode ?? null,
      comuna_slug: comunaMatch?.slug ?? null,
      comuna_label: comunaMatch?.label ?? null,
      fetch_error: fetchError,
    }

    const siiCode = (merged.sii_code as string) || null
    const candidates = siiCode
      ? await findSiiCandidatesV3(siiCode, {
          address: (merged.address as string) ?? null,
          address_full: (merged.address_full as string) ?? (merged.address as string) ?? null,
          sqm: (merged.sqm as number) ?? null,
          lat: (merged.lat as number) ?? null,
          lng: (merged.lng as number) ?? null,
          operation: (merged.operation as string) ?? null,
          property_type: (merged.property_type as string) ?? null,
          price_raw: (merged.price_raw as number) ?? null,
          currency: (merged.currency as string) ?? null,
        } as ParsedListing)
      : []

    return NextResponse.json({
      success: true,
      url: url.split('#')[0].split('?')[0],
      extracted: merged,
      sii_candidates: candidates,
      sii_code: siiCode,
      comuna_label: comunaMatch?.label ?? null,
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}
