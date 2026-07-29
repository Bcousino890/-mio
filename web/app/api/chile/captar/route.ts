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
  const id = sp.get('id')?.trim()
  const stage = sp.get('stage')
  const review = sp.get('needs_review')
  const comuna = sp.get('sii_comuna_code')
  const limit = Math.min(Number(sp.get('limit')) || 50, 200)

  const conditions: string[] = []
  const params: unknown[] = []
  const add = (v: unknown) => { params.push(v); return `$${params.length}` }

  // Detalle por id (deep-link desde la ficha de Propiedades: al guardar el pin
  // manual se crea/actualiza una captación y se enlaza a ?id=<id>). Ignora el
  // resto de filtros — se pide UNA captación puntual.
  if (id) conditions.push(`cap.id = ${add(id)}`)
  if (stage) conditions.push(`cap.stage = ${add(stage)}`)
  if (review === 'true') conditions.push(`cap.needs_review = true`)
  if (comuna) conditions.push(`cap.sii_comuna_code = ${add(comuna)}`)

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  try {
    // Se arrastra la ficha de Propiedades que originó la captación (0083) para
    // que la lista pueda volver al inmueble y mostrar su estado comercial: sin
    // esto el pipeline se veía como una tabla suelta, desconectada de la
    // propiedad que se está trabajando.
    const { rows } = await pool.query(
      `SELECT cap.*,
              pc.ref_code     AS property_ref_code,
              pc.smart_crm_at AS property_smart_crm_at
         FROM captaciones_cl cap
         LEFT JOIN property_cl pc ON pc.id = cap.property_cl_id
         ${where}
        ORDER BY cap.updated_at DESC
        LIMIT ${limit}`,
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
