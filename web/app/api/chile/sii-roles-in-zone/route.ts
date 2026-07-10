import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

interface ZoneShape {
  type: 'polygon' | 'circle' | 'rectangle'
  coordinates?: [number, number][] // [lat, lng] pairs, closed ring
  center?: [number, number] // [lat, lng]
  radius?: number // meters
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const siiComunaCode = String(body.sii_comuna_code ?? '').trim()
    const shape = body.shape as ZoneShape | undefined
    // Con include_roles=true devuelve además la lista de roles dentro de la
    // zona (para el panel de farming y el export CSV del visor).
    const includeRoles = body.include_roles === true
    const rolesLimit = Math.min(Number(body.roles_limit ?? 500), 2000)

    if (!siiComunaCode || !shape) {
      return NextResponse.json({ success: false, error: 'sii_comuna_code and shape required' }, { status: 400 })
    }

    const params: (string | number)[] = [siiComunaCode]
    let geoCondition: string

    if (shape.type === 'circle') {
      if (!shape.center || !shape.radius) {
        return NextResponse.json({ success: false, error: 'circle requires center and radius' }, { status: 400 })
      }
      params.push(shape.center[1], shape.center[0], shape.radius)
      geoCondition = `ST_DWithin(cp.geom::geography, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4)`
    } else {
      if (!shape.coordinates || shape.coordinates.length < 4) {
        return NextResponse.json({ success: false, error: 'polygon requires at least 4 coordinates' }, { status: 400 })
      }
      const wkt = `POLYGON((${shape.coordinates.map(([lat, lng]) => `${lng} ${lat}`).join(', ')}))`
      params.push(wkt)
      geoCondition = `ST_Intersects(cp.geom, ST_GeomFromText($2, 4326))`
    }

    const result = await pool.query(
      `SELECT COUNT(DISTINCT sr.rol) as count,
              AVG(sr.avaluo_fiscal_total) as avaluo_promedio,
              SUM(sr.avaluo_fiscal_total) as avaluo_total
       FROM cadastre_parcels_cl cp
       JOIN chile_comunas cc ON cp.comuna_id = cc.id
       JOIN sii_roles_cl sr ON cp.rol = sr.rol AND cc.sii_comuna_code = sr.sii_comuna_code
       WHERE cc.sii_comuna_code = $1 AND ${geoCondition}`,
      params
    )

    const row = result.rows[0]

    // Lista de roles dentro de la zona. DISTINCT ON (sr.rol) porque un mismo
    // rol puede tener varias filas en sii_roles_cl (reprocesos) y varias
    // parcelas pueden intersectar la zona — se toma la fila de mayor avalúo.
    let roles: unknown[] | undefined
    if (includeRoles) {
      const rolesResult = await pool.query(
        `SELECT DISTINCT ON (sr.rol)
                sr.rol, sr.direccion, sr.avaluo_fiscal_total, sr.superficie_terreno_m2,
                sr.codigo_destino_principal, sr.nombre_propietario, sr.lat, sr.lng
         FROM cadastre_parcels_cl cp
         JOIN chile_comunas cc ON cp.comuna_id = cc.id
         JOIN sii_roles_cl sr ON cp.rol = sr.rol AND cc.sii_comuna_code = sr.sii_comuna_code
         WHERE cc.sii_comuna_code = $1 AND ${geoCondition}
         ORDER BY sr.rol, sr.avaluo_fiscal_total DESC NULLS LAST
         LIMIT ${rolesLimit}`,
        params
      )
      roles = rolesResult.rows.map(r => ({
        rol: r.rol,
        direccion: r.direccion,
        avaluo_fiscal_total: r.avaluo_fiscal_total != null ? Number(r.avaluo_fiscal_total) : null,
        superficie_terreno_m2: r.superficie_terreno_m2 != null ? Number(r.superficie_terreno_m2) : null,
        codigo_destino_principal: r.codigo_destino_principal,
        nombre_propietario: r.nombre_propietario,
        lat: r.lat != null ? Number(r.lat) : null,
        lng: r.lng != null ? Number(r.lng) : null,
      }))
    }

    return NextResponse.json({
      success: true,
      count: Number(row?.count ?? 0),
      avaluo_promedio: row?.avaluo_promedio ? Number(row.avaluo_promedio) : null,
      avaluo_total: row?.avaluo_total ? Number(row.avaluo_total) : null,
      ...(roles !== undefined ? { roles } : {}),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
