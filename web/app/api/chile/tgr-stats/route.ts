import { NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Heurística simple para distinguir persona natural vs empresa por el nombre
// que devuelve el certificado TGR (no hay campo estructurado para esto).
const PATRONES_EMPRESA = [
  'S.A.', 'SPA', 'LTDA', 'EIRL', 'E.I.R.L', 'SOCIEDAD', 'LIMITADA',
  'INMOBILIARIA', 'INVERSIONES', 'COMERCIAL', 'CONSTRUCTORA', 'INC.',
  'CORP', 'COMPAÑIA', 'COMPAÑÍA', 'FONDO', 'INMOBILIARIA',
]

function esEmpresa(nombre: string | null): boolean {
  if (!nombre) return false
  const n = nombre.toUpperCase()
  return PATRONES_EMPRESA.some((p) => n.includes(p))
}

export async function GET() {
  try {
    const [globalRes, comunaRes, ultimosRes, erroresRes, esperadosRes, heartbeatRes, nombresRes] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE tiene_deuda) AS con_deuda,
          COUNT(*) FILTER (WHERE estado = 'sin_deuda') AS sin_deuda,
          COUNT(*) FILTER (WHERE estado = 'error') AS errores,
          COUNT(*) FILTER (WHERE nombre IS NOT NULL AND nombre != '') AS con_nombre,
          COUNT(*) FILTER (WHERE nombre IS NULL OR nombre = '') AS sin_nombre,
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
      pool.query(`
        SELECT rol, comuna, error, intentos, fecha_consulta
        FROM tgr_certificados
        WHERE estado = 'error'
        ORDER BY fecha_consulta DESC
        LIMIT 50
      `),
      pool.query(`
        SELECT COUNT(*) AS total
        FROM sii_roles_cl r
        JOIN chile_comunas c ON c.id = r.comuna_id
        WHERE c.region = 'Región Metropolitana de Santiago'
      `),
      pool.query(`
        SELECT MAX(fecha_consulta) AS ultima, COUNT(*) FILTER (WHERE fecha_consulta > now() - interval '5 minutes') AS recientes
        FROM tgr_certificados
      `),
      pool.query(`SELECT nombre FROM tgr_certificados WHERE nombre IS NOT NULL AND nombre != ''`),
    ])

    const g = globalRes.rows[0]
    const hb = heartbeatRes.rows[0]
    const esperados = Number(esperadosRes.rows[0].total)
    const total = Number(g.total)

    let personas = 0
    let empresas = 0
    for (const r of nombresRes.rows) {
      if (esEmpresa(r.nombre)) empresas++
      else personas++
    }

    const ultimaConsulta = hb.ultima as Date | null
    const segundosDesdeUltima = ultimaConsulta ? (Date.now() - new Date(ultimaConsulta).getTime()) / 1000 : null
    const corriendo = segundosDesdeUltima !== null && segundosDesdeUltima < 120

    return NextResponse.json({
      success: true,
      scraper_status: {
        corriendo,
        ultima_consulta: ultimaConsulta,
        segundos_desde_ultima: segundosDesdeUltima,
        procesados_ultimos_5min: Number(hb.recientes),
      },
      globales: {
        total,
        esperados,
        progreso_pct: esperados > 0 ? Math.round((total / esperados) * 1000) / 10 : 0,
        con_deuda: Number(g.con_deuda),
        sin_deuda: Number(g.sin_deuda),
        errores: Number(g.errores),
        con_nombre: Number(g.con_nombre),
        sin_nombre: Number(g.sin_nombre),
        personas,
        empresas,
        monto_total_deuda: Number(g.monto_total_deuda),
      },
      por_comuna: comunaRes.rows.map(r => ({
        comuna: r.comuna,
        total: Number(r.total),
        con_deuda: Number(r.con_deuda),
        errores: Number(r.errores),
      })),
      ultimos: ultimosRes.rows,
      errores_detalle: erroresRes.rows,
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
