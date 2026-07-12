import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

// Comunas con datos SII realmente ingeridos (sii_roles_cl), no la lista
// curada a mano del frontend. Sirve para que el selector de comunas de
// /chile/catastro muestre cualquier comuna que ya tenga roles cargados,
// aunque nadie haya agregado su entrada al array ZONES.
export async function GET() {
  try {
    const result = await pool.query(
      `SELECT sr.sii_comuna_code,
              cc.name    AS comuna,
              cc.region,
              COUNT(*)   AS roles,
              AVG(sr.lat) AS lat,
              AVG(sr.lng) AS lng
       FROM sii_roles_cl sr
       JOIN chile_comunas cc ON cc.sii_comuna_code = sr.sii_comuna_code
       GROUP BY sr.sii_comuna_code, cc.name, cc.region
       ORDER BY cc.name`
    )
    return NextResponse.json({
      success: true,
      zones: result.rows.map(r => ({
        siiCode: r.sii_comuna_code,
        comuna: r.comuna,
        region: r.region,
        roles: Number(r.roles),
        lat: r.lat != null ? Number(r.lat) : null,
        lng: r.lng != null ? Number(r.lng) : null,
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
