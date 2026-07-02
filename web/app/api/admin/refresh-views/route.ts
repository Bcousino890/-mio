import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

/**
 * POST /api/admin/refresh-views — refresca las vistas materializadas de
 * mercado (mv_market_area, mv_broken_exclusives, mv_opportunities) vía la
 * función refresh_market_views() de la migración 0050. Pensado para el botón
 * de Settings y para cron.
 */
export async function POST() {
  try {
    const { rows } = await pool.query(`SELECT * FROM refresh_market_views()`)
    const failed = rows.filter((r) => !r.ok)
    return NextResponse.json({
      success: failed.length === 0,
      results: rows,
    }, { status: failed.length === 0 ? 200 : 207 })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
