import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const rol = searchParams.get('rol')
    const lat = searchParams.get('lat')
    const lng = searchParams.get('lng')

    if (!rol) {
      return NextResponse.json({
        error: 'Parámetro "rol" requerido',
        example: '/api/debug/sii-roles-status?rol=2922-27',
      }, { status: 400 })
    }

    // Query el rol específico
    const query = `
      SELECT
        rol,
        direccion,
        lat,
        lng,
        codigo_destino_principal,
        superficie_terreno_m2,
        superficie_construida_m2,
        avaluo_fiscal_total,
        sii_comuna_code,
        CASE WHEN lat IS NOT NULL AND lng IS NOT NULL THEN 'SI' ELSE 'NO' END as tiene_coords,
        CASE WHEN $1::double precision IS NOT NULL AND $2::double precision IS NOT NULL
             AND lat IS NOT NULL AND lng IS NOT NULL
             THEN ST_DistanceSphere(
               ST_SetSRID(ST_MakePoint(lng, lat), 4326),
               ST_SetSRID(ST_MakePoint($2, $1), 4326)
             )::integer
             ELSE NULL END as distance_m_desde_pin
      FROM sii_roles_cl
      WHERE rol = $3
      LIMIT 1
    `

    const params = [lat ? parseFloat(lat) : null, lng ? parseFloat(lng) : null, rol]
    const res = await pool.query(query, params)

    if (res.rows.length === 0) {
      return NextResponse.json({
        found: false,
        rol: rol,
        message: 'Rol no encontrado en BD',
      })
    }

    const row = res.rows[0]

    return NextResponse.json({
      found: true,
      rol: row.rol,
      direccion: row.direccion,
      tiene_coordenadas: row.tiene_coords === 'SI',
      lat: row.lat,
      lng: row.lng,
      codigo_destino_principal: row.codigo_destino_principal,
      superficie_terreno_m2: row.superficie_terreno_m2,
      superficie_construida_m2: row.superficie_construida_m2,
      avaluo_fiscal_total: row.avaluo_fiscal_total,
      sii_comuna_code: row.sii_comuna_code,
      distancia_desde_pin_m: row.distance_m_desde_pin,
      pin_usado: lat && lng ? `${lat}, ${lng}` : 'ninguno',
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
