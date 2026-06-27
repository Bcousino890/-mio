import { NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function GET() {
  try {
    const [globalRes, comunaRes, ultimosRes] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE tiene_deuda) AS con_deuda,
          COUNT(*) FILTER (WHERE estado = 'sin_deuda') AS sin_deuda,
          COUNT(*) FILTER (WHERE estado = 'error') AS errores,
          COALESCE(SUM(total_deuda_no_vencida), 0) + COALESCE(SUM(total_deuda_morosa), 0) AS monto_total_deuda
        FROM tgr_certificados
      `),
      pool.query(`
        SELECT comuna, COUNT(*) AS total,
               COUNT(*) FILTER (WHERE tiene_deuda) AS con_deuda,
               COUNT(*) FILTER (WHERE estado = 'error') AS errores
        FROM tgr_certificados
        GROUP BY comuna
        ORDER BY total DESC
      `),
      pool.query(`
        SELECT rol, comuna, nombre, tiene_deuda, total_deuda_no_vencida, estado, fecha_consulta
        FROM tgr_certificados
        ORDER BY fecha_consulta DESC
        LIMIT 20
      `),
    ])

    const g = globalRes.rows[0]
    return NextResponse.json({
      success: true,
      globales: {
        total: Number(g.total),
        con_deuda: Number(g.con_deuda),
        sin_deuda: Number(g.sin_deuda),
        errores: Number(g.errores),
        monto_total_deuda: Number(g.monto_total_deuda),
      },
      por_comuna: comunaRes.rows.map(r => ({
        comuna: r.comuna,
        total: Number(r.total),
        con_deuda: Number(r.con_deuda),
        errores: Number(r.errores),
      })),
      ultimos: ultimosRes.rows,
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
