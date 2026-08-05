import { NextRequest, NextResponse } from 'next/server'
import { getCaptacion, lookupContactsDealernet, finishDealernetByRut } from '@/lib/captar-pipeline'
import { parseRut, isValidRut } from '@/lib/dealernet'

/**
 * POST /api/chile/captar/[id]/dealernet — etapa 4: RUT + teléfonos del dueño.
 *
 * Sin body: búsqueda automática (Buscador Múltiple por rol → nombre →
 * dirección, eligiendo el RUT cuyo nombre calza con el dueño TGR).
 * Con body {rut}: selección manual de RUT cuando la búsqueda fue ambigua.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let manualRut: string | null = null
  try {
    const body = await request.json()
    if (body?.rut) manualRut = String(body.rut)
  } catch {
    // sin body = búsqueda automática
  }

  try {
    if (manualRut) {
      const rut = parseRut(manualRut)
      if (!rut || !isValidRut(rut)) {
        return NextResponse.json({ success: false, error: 'RUT inválido' }, { status: 400 })
      }
      const c = await getCaptacion(id)
      if (!c) return NextResponse.json({ success: false, error: 'Captación no encontrada' }, { status: 404 })
      // manual: true — RUT puntual elegido a mano, no la identificación
      // primaria del dueño. No debe pisar owner_rut/owner_rut_candidates ni
      // reemplazar los teléfonos ya encontrados (ver finishDealernetByRut).
      const result = await finishDealernetByRut(c, rut.num, rut.dv, { manual: true })
      return NextResponse.json({
        success: result.captacion.dealernet_status === 'ok',
        captacion: result.captacion,
        error: result.captacion.dealernet_error,
      })
    }

    const result = await lookupContactsDealernet(id)
    return NextResponse.json({
      success: result.captacion.dealernet_status === 'ok',
      captacion: result.captacion,
      rut_candidates: result.rut_candidates ?? null,
      error: result.captacion.dealernet_error,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
