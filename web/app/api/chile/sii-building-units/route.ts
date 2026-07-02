import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

/**
 * GET /api/chile/sii-building-units?sii_comuna_code=15108&rol_padre=795-1
 *
 * Returns all department/unit roles that belong to a parent building rol.
 * Also works in reverse: if you pass a unit's rol, finds its siblings via rol_padre.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const siiComunaCode = sp.get('sii_comuna_code')?.trim()
  const rolPadre = sp.get('rol_padre')?.trim()

  if (!siiComunaCode || !rolPadre) {
    return NextResponse.json({ success: false, error: 'sii_comuna_code and rol_padre required' }, { status: 400 })
  }

  try {
    const res = await pool.query(
      `SELECT rol, direccion, avaluo_fiscal_total, superficie_terreno_m2,
              codigo_destino_principal, rol_padre, rol_bien_comun_1, rol_bien_comun_2,
              manzana, predio
       FROM sii_roles_cl
       WHERE sii_comuna_code = $1 AND rol_padre = $2
       ORDER BY manzana ASC, predio ASC
       LIMIT 500`,
      [siiComunaCode, rolPadre]
    )

    return NextResponse.json({
      success: true,
      rol_padre: rolPadre,
      total: res.rows.length,
      units: res.rows,
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
