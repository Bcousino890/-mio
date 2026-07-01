import { NextRequest, NextResponse } from 'next/server'
import {
  queryDealernetBuscadorMultiple,
  BUSCADOR_MULTIPLE_TIPOS,
  type BuscadorMultipleTipo,
} from '@/lib/dealernet'

const VALID_TIPOS = new Set<string>(BUSCADOR_MULTIPLE_TIPOS)

// Buscador Múltiple (producto 3460): candidatos por nombre/empresa/teléfono/
// dirección/rol/patente, sin RUT de antemano. No persiste en base — es un
// paso previo para encontrar el RUT y luego usar /api/chile/dealernet-lookup.
export async function POST(request: NextRequest) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'JSON inválido' }, { status: 400 })
  }

  const tipbusq = String(body?.tipbusq ?? '')
  const args = String(body?.args ?? '').trim()

  if (!VALID_TIPOS.has(tipbusq)) {
    return NextResponse.json({ success: false, error: 'tipbusq inválido' }, { status: 400 })
  }
  if (!args) {
    return NextResponse.json({ success: false, error: 'args requerido' }, { status: 400 })
  }

  try {
    const result = await queryDealernetBuscadorMultiple(tipbusq as BuscadorMultipleTipo, args)
    return NextResponse.json({
      success: true,
      retcode: result.retcode,
      retmsg: result.retmsg,
      candidatos: result.candidatos,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error consultando DealerNet' },
      { status: 502 }
    )
  }
}
