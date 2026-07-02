import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { extractListing, matchRol } from '@/lib/captar-pipeline'

/**
 * POST /api/chile/captar — inicia el pipeline de captación para una URL de
 * Portal Inmobiliario: extrae el anuncio (etapa 1) y resuelve el rol SII
 * (etapa 2). Las etapas TGR y DealerNet se disparan con sus propias rutas
 * (son lentas: TGR levanta Chromium) — la UI las encadena.
 */
export async function POST(request: NextRequest) {
  let url: unknown
  try {
    ({ url } = await request.json())
  } catch {
    return NextResponse.json({ success: false, error: 'JSON inválido' }, { status: 400 })
  }
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ success: false, error: 'URL requerida' }, { status: 400 })
  }
  if (!/portalinmobiliario\.com|MLC-?\d+/i.test(url)) {
    return NextResponse.json({ success: false, error: 'Se espera una URL de portalinmobiliario.com (MLC-...)' }, { status: 400 })
  }

  try {
    const { captacion, fetch_error } = await extractListing(url)
    const { captacion: matched, decision, candidates } = await matchRol(captacion.id)
    return NextResponse.json({
      success: true,
      captacion: matched,
      decision,
      candidates,
      fetch_error,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

/** GET /api/chile/captar — lista de captaciones (para /chile/captacion). */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const stage = sp.get('stage')
  const review = sp.get('needs_review')
  const comuna = sp.get('sii_comuna_code')
  const limit = Math.min(Number(sp.get('limit')) || 50, 200)

  const conditions: string[] = []
  const params: unknown[] = []
  const add = (v: unknown) => { params.push(v); return `$${params.length}` }

  if (stage) conditions.push(`stage = ${add(stage)}`)
  if (review === 'true') conditions.push(`needs_review = true`)
  if (comuna) conditions.push(`sii_comuna_code = ${add(comuna)}`)

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  try {
    const { rows } = await pool.query(
      `SELECT * FROM captaciones_cl ${where} ORDER BY updated_at DESC LIMIT ${limit}`,
      params,
    )
    return NextResponse.json({ success: true, captaciones: rows, count: rows.length })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
