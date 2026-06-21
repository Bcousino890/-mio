import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

/**
 * GET /api/chile/sii-stats?sii_comuna_code=15108
 *
 * Devuelve estadísticas resumidas de la tabla sii_roles_cl para una comuna.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const siiComunaCode = sp.get('sii_comuna_code')?.trim()

  if (!siiComunaCode) {
    return NextResponse.json({ success: false, error: 'sii_comuna_code requerido' }, { status: 400 })
  }

  try {
    const statsRes = await pool.query(
      `SELECT
        COUNT(*) as total_roles,
        COUNT(*) FILTER (WHERE codigo_destino_principal = 'H') as habitacional,
        COUNT(*) FILTER (WHERE codigo_destino_principal IN ('C','O')) as comercial,
        ROUND(AVG(avaluo_fiscal_total)) as avaluo_promedio,
        ROUND(AVG(superficie_terreno_m2)) as superficie_promedio_m2
      FROM sii_roles_cl
      WHERE sii_comuna_code = $1 AND serie = 'no_agricola'`,
      [siiComunaCode]
    )

    const sampleRes = await pool.query(
      `SELECT rol, direccion, avaluo_fiscal_total, superficie_terreno_m2, codigo_destino_principal
      FROM sii_roles_cl
      WHERE sii_comuna_code = $1 AND serie = 'no_agricola' AND codigo_destino_principal = 'H'
      ORDER BY avaluo_fiscal_total DESC NULLS LAST
      LIMIT 10`,
      [siiComunaCode]
    )

    const stats = statsRes.rows[0]

    return NextResponse.json({
      success: true,
      sii_comuna_code: siiComunaCode,
      total_roles: Number(stats.total_roles),
      habitacional: Number(stats.habitacional),
      comercial: Number(stats.comercial),
      avaluo_promedio: stats.avaluo_promedio ? Number(stats.avaluo_promedio) : null,
      superficie_promedio_m2: stats.superficie_promedio_m2 ? Number(stats.superficie_promedio_m2) : null,
      sample_roles: sampleRes.rows,
    })
  } catch (error) {
    console.error('Error fetching SII stats:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch SII stats' }, { status: 500 })
  }
}
