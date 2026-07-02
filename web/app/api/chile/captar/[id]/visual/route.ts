import { NextRequest, NextResponse } from 'next/server'
import { verifyVisual } from '@/lib/captar-pipeline'

// La verificación descarga tiles satelitales + llama al modelo de visión.
export const maxDuration = 90

/**
 * POST /api/chile/captar/[id]/visual — verificación visual con IA: compara
 * las fotos del anuncio con el satélite de cada candidato (piscina, tipo de
 * techo, entorno) y re-puntúa el match. Requiere OPENROUTER_API_KEY.
 *
 * Body opcional: { photoUrls: string[] } — fotos elegidas por el usuario en el
 * selector de la UI (se validan contra las fotos del anuncio y se persisten).
 * Sin body o array vacío: fallback a las 4 primeras fotos del anuncio.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    let photoUrls: string[] | undefined
    try {
      const body = await request.json()
      if (body && Array.isArray(body.photoUrls)) {
        photoUrls = (body.photoUrls as unknown[]).filter((u): u is string => typeof u === 'string')
      }
    } catch {
      // sin body JSON → comportamiento por defecto (selección guardada o 4 primeras)
    }

    const result = await verifyVisual(id, photoUrls)
    return NextResponse.json({
      success: true,
      captacion: result.captacion,
      decision: result.decision,
      candidates: result.candidates,
      visual_usage: result.visual_usage ?? null,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
