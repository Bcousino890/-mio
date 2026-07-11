import { NextRequest, NextResponse } from 'next/server'
import {
  queryDealernetBuscadorMultiple,
  BUSCADOR_MULTIPLE_TIPOS,
  dealernetRetcodeMessage,
  type BuscadorMultipleTipo,
} from '@/lib/dealernet'
import { getCachedBuscadorMultiple, saveBuscadorMultipleCache, logDealernetQuery } from '@/lib/dealernet-cache'

const VALID_TIPOS = new Set<string>(BUSCADOR_MULTIPLE_TIPOS)

// Buscador Múltiple (producto 3460): candidatos por nombre/empresa/teléfono/
// dirección/rol/patente, sin RUT de antemano. Cada consulta a DealerNet tiene
// costo, así que se cachea en dealernet_buscador_multiple_cl (ver
// lib/dealernet-cache.ts y 0055_dealernet_buscador_multiple_cache) — la misma
// caché la comparte el pipeline de captación (lib/captar-pipeline.ts).
export async function POST(request: NextRequest) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'JSON inválido' }, { status: 400 })
  }

  const tipbusq = String(body?.tipbusq ?? '')
  const args = String(body?.args ?? '').trim()
  const force = body?.force === true

  if (!VALID_TIPOS.has(tipbusq)) {
    return NextResponse.json({ success: false, error: 'tipbusq inválido' }, { status: 400 })
  }
  if (!args) {
    return NextResponse.json({ success: false, error: 'args requerido' }, { status: 400 })
  }
  const tipo = tipbusq as BuscadorMultipleTipo
  const source = body?.source === 'ficha_catastro' ? 'ficha_catastro' : 'dealer'

  try {
    if (!force) {
      const cached = await getCachedBuscadorMultiple(tipo, args)
      if (cached) {
        await logDealernetQuery({
          kind: 'buscador_multiple', tipbusq: tipo, args, retcode: cached.retcode,
          success: true, fromCache: true, candidatosN: cached.candidatos.length, source,
        })
        return NextResponse.json({
          success: true,
          retcode: cached.retcode,
          retmsg: cached.retmsg,
          candidatos: cached.candidatos,
          from_cache: true,
        })
      }
    }

    const result = await queryDealernetBuscadorMultiple(tipo, args)

    // DealerNet responde HTTP 200 aun cuando la consulta falló (credenciales,
    // cuenta no habilitada para el producto 3460, parámetro inválido, etc.) —
    // sin este chequeo, cualquier error se veía en la UI como "Sin candidatos
    // para esta búsqueda", indistinguible de una búsqueda real sin resultados.
    // No se cachea un error: no es un resultado reutilizable (credenciales o
    // cuenta pueden arreglarse y la próxima consulta sí debe ir en vivo).
    const retcodeError = dealernetRetcodeMessage(result.retcode)
    if (retcodeError) {
      await logDealernetQuery({
        kind: 'buscador_multiple', tipbusq: tipo, args, retcode: result.retcode,
        success: false, fromCache: false, source, error: retcodeError,
      })
      return NextResponse.json(
        { success: false, error: `DealerNet: ${retcodeError}${result.retmsg ? ` (${result.retmsg})` : ''}`, retcode: result.retcode },
        { status: 502 }
      )
    }

    await saveBuscadorMultipleCache(tipo, args, result)
    await logDealernetQuery({
      kind: 'buscador_multiple', tipbusq: tipo, args, retcode: result.retcode,
      success: true, fromCache: false, candidatosN: result.candidatos.length, source,
    })

    return NextResponse.json({
      success: true,
      retcode: result.retcode,
      retmsg: result.retmsg,
      candidatos: result.candidatos,
      from_cache: false,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error consultando DealerNet'
    await logDealernetQuery({ kind: 'buscador_multiple', tipbusq: tipo, args, success: false, fromCache: false, source, error: msg })
    return NextResponse.json({ success: false, error: msg }, { status: 502 })
  }
}
