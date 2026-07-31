import { NextRequest, NextResponse } from 'next/server'
import { backfillSiiDireccion, getCaptacion } from '@/lib/captar-pipeline'

/** GET /api/chile/captar/[id] — estado completo de una captación. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const captacion = await getCaptacion(id)
    if (!captacion) {
      return NextResponse.json({ success: false, error: 'Captación no encontrada' }, { status: 404 })
    }
    // Rol confirmado y "Dirección exacta (SII)" en blanco: la dirección está en
    // el catastro, así que se busca y se guarda al abrir la ficha en vez de
    // dejar un "—" que no se arregla nunca. Best-effort: si el catastro de esa
    // comuna no está cargado, la ficha sale igual.
    const conDireccion = await backfillSiiDireccion(captacion).catch(() => captacion)
    return NextResponse.json({ success: true, captacion: conDireccion })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
