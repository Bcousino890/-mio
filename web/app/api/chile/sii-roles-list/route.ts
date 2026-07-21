import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

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
  const avaluoMin = sp.get('avaluo_min')?.trim()
  const avaluoMax = sp.get('avaluo_max')?.trim()
  const superficieMin = sp.get('superficie_min')?.trim()
  const superficieMax = sp.get('superficie_max')?.trim()
  const ubicacion = sp.get('ubicacion')?.trim()
  const shapeParam = sp.get('shape')?.trim()
  const sortParam = sp.get('sort') || 'avaluo_desc'
  const sort = SORT_CLAUSES[sortParam] ?? SORT_CLAUSES.avaluo_desc
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const pageSize = Math.min(Math.max(1, Number(sp.get('page_size')) || 50), 200)
  const offset = (page - 1) * pageSize

  try {
    const conditions: string[] = ['r.sii_comuna_code = $1']
    const params: (string | number | string[])[] = [siiComunaCode]
    const addParam = (v: string | number | string[]) => { params.push(v); return `$${params.length}` }

    if (serie) conditions.push(`r.serie = ${addParam(serie)}`)
    if (rolPadre) conditions.push(`r.rol_padre = ${addParam(rolPadre)}`)
    if (q) {
      const qParam = addParam(`%${q}%`)
      conditions.push(`(r.rol ILIKE ${qParam} OR r.direccion ILIKE ${qParam})`)
    }
    if (destino) {
      const codes = destino.split(',').map(c => c.trim()).filter(Boolean)
      if (codes.length > 1) {
        conditions.push(`r.codigo_destino_principal = ANY(${addParam(codes)})`)
      } else if (codes.length === 1) {
        conditions.push(`r.codigo_destino_principal = ${addParam(codes[0])}`)
      }
    }
    if (avaluoMin && !Number.isNaN(Number(avaluoMin))) conditions.push(`r.avaluo_fiscal_total >= ${addParam(Number(avaluoMin))}`)
    if (avaluoMax && !Number.isNaN(Number(avaluoMax))) conditions.push(`r.avaluo_fiscal_total <= ${addParam(Number(avaluoMax))}`)
    if (superficieMin && !Number.isNaN(Number(superficieMin))) conditions.push(`r.superficie_terreno_m2 >= ${addParam(Number(superficieMin))}`)
    if (superficieMax && !Number.isNaN(Number(superficieMax))) conditions.push(`r.superficie_terreno_m2 <= ${addParam(Number(superficieMax))}`)
    if (ubicacion === 'U' || ubicacion === 'R') conditions.push(`r.codigo_ubicacion = ${addParam(ubicacion)}`)

    // Zona dibujada en el mapa (polígono/rectángulo/círculo): filtra por
    // punto-en-área usando las coordenadas propias de sii_roles_cl, igual
    // que /api/chile/sii-roles-in-zone pero combinable con el resto de
    // filtros de esta lista.
    if (shapeParam) {
      try {
        const shape = JSON.parse(shapeParam) as {
          type: 'polygon' | 'circle' | 'rectangle'
          coordinates?: [number, number][]
          center?: [number, number]
          radius?: number
        }
        if (shape.type === 'circle' && shape.center && shape.radius) {
          const lngP = addParam(shape.center[1])
          const latP = addParam(shape.center[0])
          const radiusP = addParam(shape.radius)
          conditions.push(
            `r.lat IS NOT NULL AND r.lng IS NOT NULL AND ST_DWithin(ST_SetSRID(ST_MakePoint(r.lng, r.lat), 4326)::geography, ST_SetSRID(ST_MakePoint(${lngP}, ${latP}), 4326)::geography, ${radiusP})`
          )
        } else if (shape.coordinates && shape.coordinates.length >= 4) {
          const wkt = `POLYGON((${shape.coordinates.map(([lat, lng]) => `${lng} ${lat}`).join(', ')}))`
          const wktP = addParam(wkt)
          conditions.push(
            `r.lat IS NOT NULL AND r.lng IS NOT NULL AND ST_Contains(ST_GeomFromText(${wktP}, 4326), ST_SetSRID(ST_MakePoint(r.lng, r.lat), 4326))`
          )
        }
      } catch { /* shape inválida: se ignora el filtro geoespacial */ }
    }

    const where = `WHERE ${conditions.join(' AND ')}`

    // El mismo rol puede aparecer 2 veces en sii_roles_cl (constraint única por
    // manzana/predio crudo + dos fuentes con distinto padding de ceros). Se
    // colapsa con DISTINCT ON (rol) quedándose con la fila más completa, para
    // que la lista y los conteos no muestren duplicados.
    const dedup = `
      SELECT DISTINCT ON (r2.rol) r2.*
      FROM sii_roles_cl r2
      ${where.replace(/\br\./g, 'r2.')}
      ORDER BY r2.rol, r2.superficie_construida_m2 DESC NULLS LAST,
               (r2.nombre_propietario IS NOT NULL) DESC, (r2.lat IS NOT NULL) DESC`

    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM (${dedup}) r`, params),
      pool.query(
        `SELECT r.rol, r.manzana, r.predio, r.direccion, r.avaluo_fiscal_total,
                r.avaluo_exento, r.contribucion_semestral, r.codigo_destino_principal,
                r.codigo_ubicacion, r.superficie_terreno_m2, r.serie,
                r.rol_padre, r.rol_bien_comun_1, r.rol_bien_comun_2,
                r.lat, r.lng,
                p.matched_parcel_id
         FROM (${dedup}) r
         LEFT JOIN LATERAL (
           SELECT matched_parcel_id FROM property_rc_cl p
           WHERE p.rol_matriz = r.rol OR p.rol_unidad = r.rol
           LIMIT 1
         ) p ON true
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
