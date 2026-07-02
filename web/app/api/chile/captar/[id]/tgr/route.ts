import { NextRequest, NextResponse } from 'next/server'
import { lookupOwnerTgr } from '@/lib/captar-pipeline'

// La consulta TGR levanta Chromium y puede tardar ~30-60 s.
export const maxDuration = 120

/**
 * POST /api/chile/captar/[id]/tgr — etapa 3: obtiene el nombre del dueño desde
 * el Certificado de Deuda TGR (con cache de 90 días) y cruza la dirección del
 * certificado contra la dirección SII del rol (verificación documental).
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const result = await lookupOwnerTgr(id)
    return NextResponse.json({
      success: result.captacion.tgr_status === 'ok' || result.captacion.tgr_status === 'sin_deuda',
      captacion: result.captacion,
      from_cache: result.from_cache,
      cooldown_ms: result.cooldown_ms ?? null,
      error: result.captacion.tgr_error,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
