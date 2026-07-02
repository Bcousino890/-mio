import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

// Viewport-based loading: max features per request to keep responses <5MB
const MAX_FEATURES = 25000

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const siiComunaCode = sp.get('sii_comuna_code')?.trim()
  if (!siiComunaCode) {
    return NextResponse.json({ success: false, error: 'sii_comuna_code required' }, { status: 400 })
  }

  const q = sp.get('q')?.trim()
  const destino = sp.get('destino')?.trim()

  // Optional viewport bbox for progressive loading
  const minLat = sp.get('min_lat') ? Number(sp.get('min_lat')) : null
  const maxLat = sp.get('max_lat') ? Number(sp.get('max_lat')) : null
  const minLng = sp.get('min_lng') ? Number(sp.get('min_lng')) : null
  const maxLng = sp.get('max_lng') ? Number(sp.get('max_lng')) : null
  const hasBbox = minLat !== null && maxLat !== null && minLng !== null && maxLng !== null

  try {
    const conditions: string[] = ['r.sii_comuna_code = $1', 'r.lat IS NOT NULL', 'r.lng IS NOT NULL']
    const params: (string | number)[] = [siiComunaCode]
    const addParam = (v: string | number) => { params.push(v); return `$${params.length}` }

    if (q) {
      const qParam = addParam(`%${q}%`)
      conditions.push(`(r.rol ILIKE ${qParam} OR r.direccion ILIKE ${qParam})`)
    }
    if (destino) conditions.push(`r.codigo_destino_principal = ${addParam(destino)}`)

    if (hasBbox) {
      conditions.push(`r.lat BETWEEN ${addParam(minLat!)} AND ${addParam(maxLat!)}`)
      conditions.push(`r.lng BETWEEN ${addParam(minLng!)} AND ${addParam(maxLng!)}`)
    }

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
      total_returned: result.rows.length,
    })
  } catch (error) {
    console.error('Error fetching sii roles GeoJSON:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
