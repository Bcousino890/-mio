import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { UNIT_ADDR_MATCH, unitBaseAddressExpr } from '@/lib/sii-edificio-sql'

const SORT_CLAUSES: Record<string, string> = {
  unidades_desc: 'unidades DESC, avaluo_total DESC NULLS LAST',
  avaluo_desc: 'avaluo_total DESC NULLS LAST',
}

/**
 * GET /api/chile/sii-edificios?sii_comuna_code=15103&q=peumo&page=1
 *
 * Edificios/condominios de una comuna agrupando sii_roles_cl por dirección
 * base (ver web/lib/sii-edificio-sql.ts). Funciona a nivel nacional aunque
 * el dataset no traiga rol_padre/rol_bien_comun (catastral.cl los trae NULL).
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const siiComunaCode = sp.get('sii_comuna_code')?.trim()
  if (!siiComunaCode) return NextResponse.json({ success: false, error: 'sii_comuna_code required' }, { status: 400 })

  const q = sp.get('q')?.trim()
  const sort = SORT_CLAUSES[sp.get('sort') ?? ''] ?? SORT_CLAUSES.unidades_desc
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const pageSize = Math.min(Math.max(1, Number(sp.get('page_size')) || 50), 200)
  const offset = (page - 1) * pageSize

  try {
    const params: (string | number)[] = [siiComunaCode]
    let qCondition = ''
    if (q) {
      params.push(`%${q}%`)
      qCondition = `AND direccion ILIKE $${params.length}`
    }

    const res = await pool.query(
      `WITH unidades AS (
         SELECT ${unitBaseAddressExpr('direccion')} AS direccion_base,
                rol, manzana, avaluo_fiscal_total, codigo_destino_principal
         FROM sii_roles_cl
         WHERE sii_comuna_code = $1
           AND direccion ~ '${UNIT_ADDR_MATCH}'
           ${qCondition}
       ),
       grupos AS (
         SELECT direccion_base,
                MIN(manzana) AS manzana,
                COUNT(*)::int AS unidades,
                COUNT(*) FILTER (WHERE codigo_destino_principal = 'H')::int AS habitacionales,
                SUM(avaluo_fiscal_total) AS avaluo_total,
                AVG(avaluo_fiscal_total) AS avaluo_promedio,
                (ARRAY_AGG(rol ORDER BY avaluo_fiscal_total DESC NULLS LAST))[1] AS rol_muestra
         FROM unidades
         GROUP BY direccion_base
         HAVING COUNT(*) >= 2
       )
       SELECT *, COUNT(*) OVER ()::int AS total_grupos
       FROM grupos
       ORDER BY ${sort}
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    )

    const total = res.rows[0]?.total_grupos ?? 0
    return NextResponse.json({
      success: true,
      total,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      data: res.rows.map(r => ({
        direccion_base: r.direccion_base,
        manzana: r.manzana,
        unidades: r.unidades,
        habitacionales: r.habitacionales,
        otros: r.unidades - r.habitacionales,
        avaluo_total: r.avaluo_total != null ? Number(r.avaluo_total) : null,
        avaluo_promedio: r.avaluo_promedio != null ? Math.round(Number(r.avaluo_promedio)) : null,
        rol_muestra: r.rol_muestra,
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
