import { NextRequest, NextResponse } from 'next/server'
import { verifyVisual } from '@/lib/captar-pipeline'

// La verificación descarga tiles satelitales + llama al modelo de visión.
export const maxDuration = 90

/**
 * POST /api/chile/captar/[id]/visual — verificación visual con IA: compara
 * las fotos del anuncio con el satélite de cada candidato (piscina, tipo de
 * techo, entorno) y re-puntúa el match. Requiere OPENROUTER_API_KEY.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const result = await verifyVisual(id)
    return NextResponse.json({
      success: true,
      captacion: result.captacion,
      decision: result.decision,
      candidates: result.candidates,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
