import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const SORT_CLAUSES: Record<string, string> = {
  avaluo_desc: 'r.avaluo_fiscal_total DESC NULLS LAST',
  avaluo_asc: 'r.avaluo_fiscal_total ASC NULLS LAST',
  superficie_desc: 'r.superficie_terreno_m2 DESC NULLS LAST',
  rol_asc: 'r.manzana ASC, r.predio ASC',
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const siiComunaCode = sp.get('sii_comuna_code')?.trim()
  if (!siiComunaCode) return NextResponse.json({ success: false, error: 'sii_comuna_code required' }, { status: 400 })

  const q = sp.get('q')?.trim()
  const destino = sp.get('destino')?.trim()
  const rolPadre = sp.get('rol_padre')?.trim()
  const serie = sp.get('serie')?.trim() || ''
  const sortParam = sp.get('sort') || 'avaluo_desc'
  const sort = SORT_CLAUSES[sortParam] ?? SORT_CLAUSES.avaluo_desc
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const pageSize = Math.min(Math.max(1, Number(sp.get('page_size')) || 50), 200)
  const offset = (page - 1) * pageSize

  try {
    const conditions: string[] = ['r.sii_comuna_code = $1']
    const params: (string | number)[] = [siiComunaCode]
    const addParam = (v: string | number) => { params.push(v); return `$${params.length}` }

    if (serie) conditions.push(`r.serie = ${addParam(serie)}`)
    if (rolPadre) conditions.push(`r.rol_padre = ${addParam(rolPadre)}`)
    if (q) {
      const qParam = addParam(`%${q}%`)
      conditions.push(`(r.rol ILIKE ${qParam} OR r.direccion ILIKE ${qParam})`)
    }
    if (destino) conditions.push(`r.codigo_destino_principal = ${addParam(destino)}`)

    const where = `WHERE ${conditions.join(' AND ')}`

    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM sii_roles_cl r ${where}`, params),
      pool.query(
        `SELECT r.rol, r.manzana, r.predio, r.direccion, r.avaluo_fiscal_total,
                r.avaluo_exento, r.contribucion_semestral, r.codigo_destino_principal,
                r.codigo_ubicacion, r.superficie_terreno_m2, r.serie,
                r.rol_padre, r.rol_bien_comun_1, r.rol_bien_comun_2,
                p.matched_parcel_id
         FROM sii_roles_cl r
         LEFT JOIN property_rc_cl p ON r.rol = p.rol_matriz OR r.rol = p.rol_unidad
         ${where}
         ORDER BY ${sort}
         LIMIT ${pageSize} OFFSET ${offset}`,
        params
      ),
    ])

    const total = Number(countRes.rows[0]?.total ?? 0)
    return NextResponse.json({
      success: true,
      total,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      data: dataRes.rows,
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
