import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const siiComunaCode = sp.get('sii_comuna_code')?.trim()
  const rol = sp.get('rol')?.trim()
  if (!siiComunaCode || !rol) {
    return NextResponse.json({ success: false, error: 'sii_comuna_code and rol required' }, { status: 400 })
  }

  try {
    const rolRes = await pool.query(
      `SELECT * FROM sii_roles_cl WHERE sii_comuna_code = $1 AND rol = $2 LIMIT 1`,
      [siiComunaCode, rol]
    )
    if (rolRes.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Rol not found' }, { status: 404 })
    }
    const rolRow = rolRes.rows[0]

    let construcciones: any[] = []
    try {
      const constRes = await pool.query(
        `SELECT destino, anio_construccion, superficie_m2, numero_pisos, calidad
         FROM sii_construcciones_cl WHERE rol_id = $1 ORDER BY superficie_m2 DESC NULLS LAST`,
        [rolRow.id]
      )
      construcciones = constRes.rows
    } catch {
      // Table may not exist yet — return empty array
    }

    return NextResponse.json({
      success: true,
      rol: rolRow,
      construcciones,
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
