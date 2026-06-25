import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Aumentado a 50k para mostrar toda una comuna pequeña.
// El clustering en el frontend (Leaflet MarkerCluster) maneja la renderización eficiente.
const MAX_FEATURES = 50000

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const siiComunaCode = sp.get('sii_comuna_code')?.trim()
  if (!siiComunaCode) {
    return NextResponse.json({ success: false, error: 'sii_comuna_code required' }, { status: 400 })
  }

  const q = sp.get('q')?.trim()
  const destino = sp.get('destino')?.trim()

  try {
    const conditions: string[] = ['r.sii_comuna_code = $1', 'r.lat IS NOT NULL', 'r.lng IS NOT NULL']
    const params: (string | number)[] = [siiComunaCode]
    const addParam = (v: string | number) => { params.push(v); return `$${params.length}` }

    if (q) {
      const qParam = addParam(`%${q}%`)
      conditions.push(`(r.rol ILIKE ${qParam} OR r.direccion ILIKE ${qParam})`)
    }
    if (destino) conditions.push(`r.codigo_destino_principal = ${addParam(destino)}`)

    const where = `WHERE ${conditions.join(' AND ')}`
    const limitParam = addParam(MAX_FEATURES)

    const result = await pool.query(
      `SELECT r.rol, r.direccion, r.avaluo_fiscal_total, r.codigo_destino_principal,
              r.superficie_terreno_m2, r.lat, r.lng
       FROM sii_roles_cl r
       ${where}
       LIMIT ${limitParam}`,
      params
    )

    if (result.rows.length === MAX_FEATURES) {
      console.warn(`sii-roles-geojson: truncated results at ${MAX_FEATURES} for sii_comuna_code=${siiComunaCode}`)
    }

    const features = result.rows.map((row) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(row.lng), Number(row.lat)] },
      properties: {
        rol: row.rol,
        direccion: row.direccion,
        avaluo_fiscal_total: row.avaluo_fiscal_total,
        codigo_destino_principal: row.codigo_destino_principal,
        superficie_terreno_m2: row.superficie_terreno_m2,
      },
    }))

    return NextResponse.json({
      success: true,
      type: 'FeatureCollection',
      features,
      truncated: result.rows.length === MAX_FEATURES,
    })
  } catch (error) {
    console.error('Error fetching sii roles GeoJSON:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
