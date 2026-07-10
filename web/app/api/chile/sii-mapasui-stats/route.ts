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
 * cada SII_INGEST_INTERVAL_SEC (default 600 s), y el cron de respaldo
 * (ingest-sii-mapasui-now.yml, cada 30 min) lo re-ingesta aunque el scrape ya
 * haya terminado. El upsert bumpea updated_at aunque el lote no traiga predios
 * nuevos, así que GREATEST(created_at, updated_at) refleja la última escritura.
 *
 * El latido tiene TRES niveles, no un binario activo/inactivo, porque "scrape
 * en reposo / comuna completa" es un estado SANO y no debe pintarse como la
 * alarma de "pipeline muerto 19 h" que motivó este panel:
 *   - ingestando (<15 min): el scrape está escribiendo ahora mismo, o acaba de
 *     correr un lote/cron. 1.5× la cadencia incremental de 600 s.
 *   - al_dia (<6 h): sin lote reciente pero el cron de respaldo lo mantiene
 *     fresco; típico cuando el scrape de la comuna ya terminó. NO es problema.
 *   - estancado (>=6 h): ni la ingesta incremental ni el cron de respaldo
 *     escribieron en horas — el pipeline (o GitHub Actions / VPS / DB) está
 *     realmente caído y hay que mirarlo.
 *
 * ¿Por qué 6 h y no 2 h? Los scheduled runs de GitHub Actions se descartan y
 * retrasan mucho: aun pidiendo el cron cada 30 min, se han observado gaps
 * reales de ~3 h30 entre corridas. 6 h deja margen de sobra sobre ese jitter
 * (sin falsas alarmas en reposo normal) pero sigue MUY por debajo de las 19 h
 * que el usuario consideró un fallo, así que una caída real se detecta a tiempo.
 */
const VENTANA_INGESTANDO_SEG = 15 * 60
const VENTANA_AL_DIA_SEG = 6 * 60 * 60

type NivelIngesta = 'ingestando' | 'al_dia' | 'estancado' | 'sin_datos'

function nivelIngesta(segundosDesdeUltima: number | null): NivelIngesta {
  if (segundosDesdeUltima === null) return 'sin_datos'
  if (segundosDesdeUltima < VENTANA_INGESTANDO_SEG) return 'ingestando'
  if (segundosDesdeUltima < VENTANA_AL_DIA_SEG) return 'al_dia'
  return 'estancado'
}
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
    const nivel = nivelIngesta(segundosDesdeUltima)
    // `activo` se mantiene por compatibilidad: verdadero salvo que el pipeline
    // esté realmente estancado (>=2 h sin escritura) o sin datos.
    const activo = nivel === 'ingestando' || nivel === 'al_dia'

    return NextResponse.json({
      success: true,
      ingesta_status: {
        activo,
        nivel,
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
