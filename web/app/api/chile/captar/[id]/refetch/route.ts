import { NextRequest, NextResponse } from 'next/server'
import { extractListing, getCaptacion } from '@/lib/captar-pipeline'

/**
 * POST /api/chile/captar/[id]/refetch — vuelve a extraer el anuncio desde su
 * `source_url` para completar la ficha (fotos de la galería, descripción,
 * ficha técnica) sin tocar el rol ya resuelto ni las etapas TGR/DealerNet.
 *
 * Existe porque la primera extracción puede quedarse corta: cuando el portal
 * bloquea el modal de galería, la captación se persiste con las 5 fotos del
 * HTML estático y no había forma de reintentarlo desde la ficha — el usuario
 * veía "Fotos del anuncio (5)" de una publicación con 20 y nada que hacer.
 *
 * El upsert de `extractListing` conserva lo ya extraído (merge de
 * `raw_extracted`, y se queda con el set de fotos más grande), así que un
 * reintento fallido nunca empeora la ficha.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const current = await getCaptacion(id)
    if (!current) {
      return NextResponse.json({ success: false, error: 'Captación no encontrada' }, { status: 404 })
    }

    const before = Array.isArray(current.photos) ? current.photos.length : 0
    const { captacion, fetch_error } = await extractListing(current.source_url)
    const after = Array.isArray(captacion.photos) ? captacion.photos.length : 0

    return NextResponse.json({
      success: true,
      captacion,
      fetch_error,
      photos_before: before,
      photos_after: after,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
