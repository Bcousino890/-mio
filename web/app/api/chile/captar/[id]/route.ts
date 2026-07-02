import { NextRequest, NextResponse } from 'next/server'
import { getCaptacion } from '@/lib/captar-pipeline'

/** GET /api/chile/captar/[id] — estado completo de una captación. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const captacion = await getCaptacion(id)
    if (!captacion) {
      return NextResponse.json({ success: false, error: 'Captación no encontrada' }, { status: 404 })
    }
    return NextResponse.json({ success: true, captacion })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
