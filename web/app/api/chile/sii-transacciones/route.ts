import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

const SORT_CLAUSES: Record<string, string> = {
  fecha_desc: 't.fecha_escritura DESC NULLS LAST',
  monto_desc: 't.monto_clp DESC NULLS LAST',
  uf_m2_desc: 't.uf_por_m2 DESC NULLS LAST',
}

/**
 * GET /api/chile/sii-transacciones
 *
 * Transacciones CBR (compraventas, migración 0030) sobre sii_transacciones_cl.
 *   - ?sii_comuna_code=15160&page=1&page_size=50&sort=fecha_desc → lista
 *     paginada de la comuna (pestaña Ventas del visor).
 *   - ?sii_comuna_code=15160&rol=795-198 → historial completo del rol
 *     (sección "Ventas históricas" de la ficha, sin paginar, máx 100).
 *
 * La dirección se resuelve con LATERAL LIMIT 1 contra sii_roles_cl porque un
 * rol puede tener más de una fila (reprocesos) y el LEFT JOIN plano duplicaría
 * transacciones.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const siiComunaCode = sp.get('sii_comuna_code')?.trim()
  const rol = sp.get('rol')?.trim()
  const sortParam = sp.get('sort')
  const sort = sortParam && SORT_CLAUSES[sortParam] ? sortParam : 'fecha_desc'
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const pageSize = Math.min(Math.max(1, Number(sp.get('page_size')) || 50), 200)

  if (!siiComunaCode) {
    return NextResponse.json({ success: false, error: 'sii_comuna_code requerido' }, { status: 400 })
  }

  try {
    const params: (string | number)[] = [siiComunaCode]
    let where = 't.sii_comuna_code = $1'
    if (rol) {
      params.push(rol)
      where += ` AND t.rol = $${params.length}`
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM sii_transacciones_cl t WHERE ${where}`,
      params
    )
    const total = Number(countResult.rows[0]?.total ?? 0)

    const limit = rol ? 100 : pageSize
    const offset = rol ? 0 : (page - 1) * pageSize

    const result = await pool.query(
      `SELECT
         t.rol,
         t.fecha_escritura,
         t.monto_clp,
         t.monto_uf,
         t.superficie_m2,
         t.uf_por_m2,
         t.foja_numero_anio,
         t.cbr_nombre,
         sr.direccion,
         sr.codigo_destino_principal
       FROM sii_transacciones_cl t
       LEFT JOIN LATERAL (
         SELECT direccion, codigo_destino_principal
         FROM sii_roles_cl sr
         WHERE sr.sii_comuna_code = t.sii_comuna_code AND sr.rol = t.rol
         ORDER BY sr.avaluo_fiscal_total DESC NULLS LAST
         LIMIT 1
       ) sr ON true
       WHERE ${where}
       ORDER BY ${SORT_CLAUSES[sort]}
       LIMIT ${limit} OFFSET ${offset}`,
      params
    )

    return NextResponse.json({
      success: true,
      total,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      data: result.rows.map(r => ({
        rol: r.rol,
        fecha_escritura: r.fecha_escritura,
        monto_clp: r.monto_clp != null ? Number(r.monto_clp) : null,
        monto_uf: r.monto_uf != null ? Number(r.monto_uf) : null,
        superficie_m2: r.superficie_m2 != null ? Number(r.superficie_m2) : null,
        uf_por_m2: r.uf_por_m2 != null ? Number(r.uf_por_m2) : null,
        foja_numero_anio: r.foja_numero_anio,
        cbr_nombre: r.cbr_nombre,
        direccion: r.direccion,
        codigo_destino_principal: r.codigo_destino_principal,
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
