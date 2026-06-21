import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

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
    return NextResponse.json({
      success: true,
      count: Number(row?.count ?? 0),
      avaluo_promedio: row?.avaluo_promedio ? Number(row.avaluo_promedio) : null,
      avaluo_total: row?.avaluo_total ? Number(row.avaluo_total) : null,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
