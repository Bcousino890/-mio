import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

/**
 * GET /api/chile/avaluo-historico?sii_comuna_code=13101&rol=795-198
 *
 * Serie histórica de avalúo fiscal del rol (sii_avaluo_historico_cl, 0058),
 * ordenada por período ascendente. Alimenta el sparkline de tendencia en la
 * ficha del predio. NO es precio de venta — es avalúo fiscal.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const siiComunaCode = sp.get('sii_comuna_code')?.trim()
  const rol = sp.get('rol')?.trim()

  if (!siiComunaCode || !rol) {
    return NextResponse.json({ success: false, error: 'sii_comuna_code y rol requeridos' }, { status: 400 })
  }

  try {
    const { rows } = await pool.query(
      `SELECT periodo, avaluo_total, avaluo_exento
         FROM sii_avaluo_historico_cl
        WHERE sii_comuna_code = $1 AND rol = $2
        ORDER BY periodo ASC`,
      [siiComunaCode, rol]
    )
    return NextResponse.json({
      success: true,
      rol,
      sii_comuna_code: siiComunaCode,
      serie: rows.map(r => ({
        periodo: r.periodo,
        avaluo_total: r.avaluo_total != null ? Number(r.avaluo_total) : null,
        avaluo_exento: r.avaluo_exento != null ? Number(r.avaluo_exento) : null,
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
