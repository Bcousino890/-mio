import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

/**
 * GET /api/chile/sii-mapasui-stats
 *
 * Estado y avance de la ingesta del scraper de predios del SII
 * (`sii_mapasui_predios_cl`, ver 0052_sii_mapasui_predios_cl.sql). Paralelo a
 * `tgr-stats`, pero para la tabla de procedencia scraping (mapasui).
 *
 * Nota: a diferencia de TGR (que escribe rol por rol), esta tabla se llena por
 * LOTES — la ingesta incremental de run-sii-mapasui.sh re-ingesta el JSONL
 * cada SII_INGEST_INTERVAL_SEC (default 600 s). Por eso el latido mira
 * GREATEST(created_at, updated_at) — el upsert bumpea updated_at aunque un
 * lote no traiga predios nuevos — y la ventana de "activo" es 15 min
 * (1.5× la cadencia), no los 5 min de un goteo continuo.
 */
export async function GET() {
  try {
    const [globalRes, comunaRes, ultimosRes, heartbeatRes] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE avaluo_total IS NOT NULL) AS con_avaluo,
          COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) AS con_coords,
          COUNT(*) FILTER (WHERE direccion IS NOT NULL AND direccion <> '') AS con_direccion,
          COUNT(DISTINCT sii_comuna_code) AS comunas,
          COALESCE(SUM(avaluo_total), 0) AS avaluo_total_sum
        FROM sii_mapasui_predios_cl
      `),
      pool.query(`
        SELECT m.sii_comuna_code,
               COALESCE(c.name, m.sii_comuna_code) AS comuna,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE m.lat IS NOT NULL AND m.lng IS NOT NULL) AS con_coords,
               COALESCE(SUM(m.avaluo_total), 0) AS avaluo_total_sum
        FROM sii_mapasui_predios_cl m
        LEFT JOIN chile_comunas c ON c.id = m.comuna_id
        GROUP BY m.sii_comuna_code, c.name
        ORDER BY total DESC
      `),
      pool.query(`
        SELECT m.rol, m.sii_comuna_code,
               COALESCE(c.name, m.sii_comuna_code) AS comuna,
               m.direccion, m.avaluo_total, m.lat, m.lng,
               m.area_homogenea, m.superficie_banda, m.created_at
        FROM sii_mapasui_predios_cl m
        LEFT JOIN chile_comunas c ON c.id = m.comuna_id
        ORDER BY m.created_at DESC
        LIMIT 20
      `),
      pool.query(`
        SELECT MAX(GREATEST(created_at, updated_at)) AS ultima,
               COUNT(*) FILTER (WHERE created_at > now() - interval '15 minutes') AS recientes
        FROM sii_mapasui_predios_cl
      `),
    ])

    const g = globalRes.rows[0]
    const hb = heartbeatRes.rows[0]

    const ultimaIngesta = hb.ultima as Date | null
    const segundosDesdeUltima = ultimaIngesta ? (Date.now() - new Date(ultimaIngesta).getTime()) / 1000 : null
    // "activo" si hubo escritura (insert o upsert) en los últimos 15 min:
    // 1.5× el intervalo de la ingesta incremental (SII_INGEST_INTERVAL_SEC=600).
    const activo = segundosDesdeUltima !== null && segundosDesdeUltima < 900

    return NextResponse.json({
      success: true,
      ingesta_status: {
        activo,
        ultima_ingesta: ultimaIngesta,
        segundos_desde_ultima: segundosDesdeUltima,
        nuevos_ultimos_15min: Number(hb.recientes),
      },
      globales: {
        total: Number(g.total),
        comunas: Number(g.comunas),
        con_avaluo: Number(g.con_avaluo),
        con_coords: Number(g.con_coords),
        con_direccion: Number(g.con_direccion),
        avaluo_total_sum: Number(g.avaluo_total_sum),
      },
      por_comuna: comunaRes.rows.map((r) => ({
        sii_comuna_code: r.sii_comuna_code,
        comuna: r.comuna,
        total: Number(r.total),
        con_coords: Number(r.con_coords),
        avaluo_total_sum: Number(r.avaluo_total_sum),
      })),
      ultimos: ultimosRes.rows.map((r) => ({
        rol: r.rol,
        sii_comuna_code: r.sii_comuna_code,
        comuna: r.comuna,
        direccion: r.direccion,
        avaluo_total: r.avaluo_total ? Number(r.avaluo_total) : null,
        lat: r.lat ? Number(r.lat) : null,
        lng: r.lng ? Number(r.lng) : null,
        area_homogenea: r.area_homogenea,
        superficie_banda: r.superficie_banda,
        created_at: r.created_at,
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
