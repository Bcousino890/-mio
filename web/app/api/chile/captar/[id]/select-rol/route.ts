import { NextRequest, NextResponse } from 'next/server'
import { selectRolManual } from '@/lib/captar-pipeline'

/**
 * POST /api/chile/captar/[id]/select-rol — el usuario elige manualmente un rol
 * entre los candidatos guardados (cuando el match automático no alcanzó el 92%
 * de probabilidad o hubo empate).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let rol: unknown
  try {
    ({ rol } = await request.json())
  } catch {
    return NextResponse.json({ success: false, error: 'JSON inválido' }, { status: 400 })
  }
  if (!rol || typeof rol !== 'string') {
    return NextResponse.json({ success: false, error: 'rol requerido' }, { status: 400 })
  }

  try {
    const captacion = await selectRolManual(id, rol)
    return NextResponse.json({ success: true, captacion })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 },
    )
  }
}
