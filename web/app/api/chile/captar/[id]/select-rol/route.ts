import { NextRequest, NextResponse } from 'next/server'
import { selectRolManual } from '@/lib/captar-pipeline'

/**
 * POST /api/chile/captar/[id]/select-rol — el usuario fija manualmente el rol
 * de la captación: un candidato de la lista (cuando el match automático no
 * alcanzó el 92% o hubo empate) o cualquier rol del catastro de la comuna,
 * señalado en el mapa de parcelas o tecleado a mano cuando la recomendación
 * automática es sencillamente errónea.
 *
 * `sii_comuna_code` es opcional: llega cuando la parcela clicada pertenece a
 * una comuna distinta de la detectada en el anuncio.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let rol: unknown
  let siiComunaCode: unknown
  try {
    ({ rol, sii_comuna_code: siiComunaCode } = await request.json())
  } catch {
    return NextResponse.json({ success: false, error: 'JSON inválido' }, { status: 400 })
  }
  if (!rol || typeof rol !== 'string') {
    return NextResponse.json({ success: false, error: 'rol requerido' }, { status: 400 })
  }

  try {
    const captacion = await selectRolManual(
      id,
      rol,
      typeof siiComunaCode === 'string' && siiComunaCode.trim() ? siiComunaCode.trim() : null,
    )
    return NextResponse.json({ success: true, captacion })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 },
    )
  }
}
