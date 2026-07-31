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
 * LOTES — la ingesta incremental de run-sii-mapasui.sh corre cada
 * SII_INGEST_INTERVAL_SEC (default 600 s), y el watchdog del cron del VPS
 * (watchdog-ingest.sh, cada 30 min) la repasa aunque el scrape ya
 * haya terminado.
 *
 * El latido sale de `sii_mapasui_ingest_state_cl` (migración 0090), NO del
 * updated_at de los predios. Dos razones:
 *   1. Desde 0090 la ingesta es incremental: si no hay líneas nuevas no se
 *      reescribe ninguna fila, así que updated_at se quedaría congelado y el
 *      panel gritaría "estancado" con el pipeline perfectamente sano.
 *   2. Al revés, antes mentía en el otro sentido: el cron llevaba días
 *      muriéndose con "Broken pipe" a los 5 min y aun así alcanzaba a
 *      reescribir filas, así que el panel decía "Al día · datos completos"
 *      mientras la ingesta fallaba corrida tras corrida.
 * `ultima_corrida` marca cuándo el ingest MIRÓ el archivo (aunque no trajera
 * nada) y `ultimo_avance` cuándo trajo líneas nuevas de verdad.
 *
 * El latido tiene TRES niveles, no un binario activo/inactivo, porque "scrape
 * en reposo / comuna completa" es un estado SANO y no debe pintarse como la
 * alarma de "pipeline muerto 19 h" que motivó este panel:
 *   - ingestando (<15 min): el scrape está escribiendo ahora mismo, o acaba de
 *     correr un lote/cron. 1.5× la cadencia incremental de 600 s.
 *   - al_dia (<2 h): sin lote reciente pero el watchdog lo mantiene fresco;
 *     típico cuando el scrape de la comuna ya terminó. NO es problema.
 *   - estancado (>=2 h): ni la ingesta incremental ni el watchdog escribieron
 *     en horas — el pipeline (o el VPS / la DB) está realmente caído.
 *
 * La ventana era de 6 h mientras el respaldo vivía en un scheduled workflow de
 * GitHub: esos runs se descartan y retrasan tanto que se veían gaps reales de
 * ~3 h30 aun pidiéndolo cada 30 min, y había que tolerarlos para no dar falsas
 * alarmas. Con el watchdog ya en el cron del VPS (cada 30 min, sin jitter)
 * ese margen sobra: 2 h siguen siendo 4 vueltas seguidas perdidas antes de
 * encender la alarma, y una caída real se ve 4 h antes que hasta ahora.
 */
const VENTANA_INGESTANDO_SEG = 15 * 60
const VENTANA_AL_DIA_SEG = 2 * 60 * 60

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

    // Estado por archivo (0090). Tolerante a que la migración aún no esté
    // aplicada en este entorno: el panel sigue funcionando con el latido viejo.
    const archivosRes = await pool
      .query(`
        SELECT archivo, byte_offset, file_size, lineas, predios, lineas_invalidas,
               ultima_corrida, ultimo_avance
        FROM sii_mapasui_ingest_state_cl
        ORDER BY archivo
      `)
      .catch(() => ({ rows: [] as Record<string, unknown>[] }))

    const g = globalRes.rows[0]
    const hb = heartbeatRes.rows[0]

    const fechas = [
      hb.ultima as Date | null,
      ...archivosRes.rows.map((r) => (r.ultima_corrida ?? null) as Date | null),
    ]
      .filter((d): d is Date => Boolean(d))
      .map((d) => new Date(d).getTime())

    const ultimaIngesta = fechas.length ? new Date(Math.max(...fechas)) : null
    const segundosDesdeUltima = ultimaIngesta ? (Date.now() - ultimaIngesta.getTime()) / 1000 : null
    const nivel = nivelIngesta(segundosDesdeUltima)
    // `activo` se mantiene por compatibilidad: verdadero salvo que el pipeline
    // esté realmente estancado (>=2 h sin escritura) o sin datos.
    const activo = nivel === 'ingestando' || nivel === 'al_dia'

    const archivos = archivosRes.rows.map((r) => {
      const byteOffset = Number(r.byte_offset ?? 0)
      const fileSize = Number(r.file_size ?? 0)
      return {
        archivo: String(r.archivo),
        lineas: Number(r.lineas ?? 0),
        predios: Number(r.predios ?? 0),
        lineas_invalidas: Number(r.lineas_invalidas ?? 0),
        byte_offset: byteOffset,
        file_size: fileSize,
        // Bytes que el último barrido dejó sin leer (una corrida cortada a la
        // mitad). En marcha normal esto es 0: se ingesta hasta el final.
        pendiente_bytes: Math.max(0, fileSize - byteOffset),
        ultima_corrida: (r.ultima_corrida ?? null) as Date | null,
        ultimo_avance: (r.ultimo_avance ?? null) as Date | null,
      }
    })

    return NextResponse.json({
      success: true,
      ingesta_status: {
        activo,
        nivel,
        ultima_ingesta: ultimaIngesta,
        segundos_desde_ultima: segundosDesdeUltima,
        nuevos_ultimos_15min: Number(hb.recientes),
        pendiente_bytes: archivos.reduce((acc, a) => acc + a.pendiente_bytes, 0),
      },
      archivos,
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
