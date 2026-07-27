import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { ProxyAgent, fetch as undiciFetch } from 'undici'

// ─────────────────────────────────────────────────────────────────────────────
// /api/chile/anuncios-health — salud del pipeline de Anuncios CL (plan · H17).
// Observabilidad SIN comandos en la VPS: cuántos anuncios crudos, propiedades
// canónicas y corredoras hay, la frescura del último barrido, y el estado de
// cada objetivo de scrape_targets_cl (last_run_at + last_listing_count). Sirve
// para saber de un vistazo si el worker está ingresando datos y, si no, por qué
// (ej. last_run_at reciente pero last_listing_count=0 = fetch fallando).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

// ─── Sonda EN VIVO del total real que declara Portal Inmobiliario ────────────
// `scrape_targets_cl.portal_reported_count` es un valor guardado la última vez
// que corrió un barrido — puede tener HORAS de antigüedad, y en ese tiempo el
// portal cambia (altas/bajas). Comparar "vistos" (de la BD) contra ese número
// viejo da una "cobertura" engañosa. Esta sonda consulta el portal AHORA MISMO,
// en cada carga del panel, para que "Portal declara" sea siempre el número real
// del momento — mismo patrón de headers que /anuncios-health/probe (verificado:
// sin esto Portal Inmobiliario sirve una variante sin el total).
const PI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-CL,es;q=0.9',
  'Upgrade-Insecure-Requests': '1',
}

/** "Las Condes" → "las-condes", "Ñuñoa" → "nunoa" (sin acentos, espacios→guiones). */
function comunaSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Proxy Evomi (residencial CL), mismas variables que usa el worker
// (scraper/lib/fetch.mjs). El contenedor `app` carga el mismo .env que
// `worker-cl` (env_file compartido) → estas variables SÍ están disponibles aquí.
function evomiProxyUrl(): string | null {
  const { EVOMI_PROXY_HOST, EVOMI_PROXY_PORT, EVOMI_PROXY_USER, EVOMI_PROXY_PASS } = process.env
  if (!EVOMI_PROXY_USER || !EVOMI_PROXY_HOST || !EVOMI_PROXY_PORT) return null
  return `http://${EVOMI_PROXY_USER}:${EVOMI_PROXY_PASS}@${EVOMI_PROXY_HOST}:${EVOMI_PROXY_PORT}`
}

async function fetchWithTimeout(url: string, opts: { dispatcher?: InstanceType<typeof ProxyAgent> } = {}, ms = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await undiciFetch(url, { headers: PI_HEADERS, redirect: 'follow', signal: controller.signal, ...opts })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Consulta el total actual de un objetivo contra Portal Inmobiliario. DIRECTO
 * primero (rápido); si el volumen sostenido del worker hace que la IP de la VPS
 * quede bloqueada (403 — visto en producción tras horas de backfill), reintenta
 * por el proxy residencial Evomi, igual que hace el worker (fetchHtmlPi).
 */
async function probeLivePortalTotal(comunaName: string, operation: string, propertyType: string): Promise<number | null> {
  const opSlug = operation === 'rent' ? 'arriendo' : 'venta'
  const typeSlug = propertyType || 'casa'
  const url = `https://www.portalinmobiliario.com/${opSlug}/${typeSlug}/propiedades-usadas/${comunaSlug(comunaName)}-metropolitana`

  const extractTotal = async (res: Awaited<ReturnType<typeof undiciFetch>>) => {
    if (!res.ok) return null
    const html = await res.text()
    const m = html.match(/"total"\s*:\s*(\d+)/)
    return m ? Number(m[1]) : null
  }

  try {
    const direct = await fetchWithTimeout(url)
    const directTotal = await extractTotal(direct)
    if (directTotal != null) return directTotal
  } catch { /* cae a proxy */ }

  const proxyUrl = evomiProxyUrl()
  if (!proxyUrl) return null
  try {
    const agent = new ProxyAgent(proxyUrl)
    const proxied = await fetchWithTimeout(url, { dispatcher: agent })
    return await extractTotal(proxied)
  } catch {
    return null
  }
}

// POST → fuerza un re-barrido: pone last_run_at=NULL en los objetivos activos,
// así el discovery-scheduler del worker (que corre cada 15 min y encola los
// objetivos "vencidos") los re-toma en la próxima pasada, sin esperar las 8h de
// cadencia. Útil en la puesta en marcha y para forzar una actualización a mano
// desde el panel, sin comandos en la VPS.
export async function POST(request: Request) {
  try {
    // ?refetch=1 → además de re-barrer, marca force_refetch para RE-BAJAR la ficha
    // de TODOS los avisos (no solo los nuevos): backfill de fotos/características/
    // permalink sobre el histórico ya scrapeado.
    const refetch = new URL(request.url).searchParams.get('refetch') === '1'
    const { rowCount } = await pool.query(
      refetch
        ? `UPDATE scrape_targets_cl SET force_refetch = true, last_run_at = NULL, updated_at = now() WHERE enabled = true`
        : `UPDATE scrape_targets_cl SET last_run_at = NULL, updated_at = now() WHERE enabled = true`
    )
    return NextResponse.json({
      success: true,
      requeued: rowCount ?? 0,
      mode: refetch ? 'refetch' : 'rescan',
      message: refetch
        ? `${rowCount ?? 0} objetivo(s) marcados para RE-SCRAPEAR toda la ficha (fotos/características/permalink) en el próximo ciclo (≤15 min).`
        : `${rowCount ?? 0} objetivo(s) marcados para re-barrido en el próximo ciclo (≤15 min).`,
    })
  } catch (error) {
    console.error('Error forzando re-barrido:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  try {
    // ?live=0 → NO sondear el portal en esta lectura. El panel se auto-refresca
    // seguido para verse en vivo, y sondear Portal Inmobiliario en cada pasada
    // serían cientos de peticiones/hora desde la IP de la VPS — justo lo que ya
    // provocó un 403 en producción. Con live=0 solo se leen los contadores de la
    // BD (baratos); el frontend conserva el último total del portal conocido y
    // lo re-sondea de tanto en tanto o cuando el usuario pulsa Refrescar.
    const skipLive = new URL(request.url).searchParams.get('live') === '0'
    const [counts, targets, versionPulse, versionPulse1h, timeline] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT count(*) FROM listings_cl) AS listings_total,
          (SELECT count(*) FROM listings_cl WHERE is_active) AS listings_active,
          (SELECT count(*) FROM listings_cl WHERE property_code IS NOT NULL) AS listings_with_code,
          (SELECT count(*) FROM listings_cl WHERE source_type = 'agency_web') AS listings_agency_web,
          (SELECT max(last_seen_at) FROM listings_cl) AS last_seen_at,
          (SELECT count(*) FROM property_cl) AS property_cl_total,
          (SELECT count(*) FROM property_cl WHERE corredora_count > 1) AS property_cl_en_canje,
          (SELECT count(*) FROM corredoras_cl) AS corredoras_total,
          (SELECT count(*) FROM corredora_web_targets_cl WHERE enabled) AS corredora_webs_enabled,
          (SELECT count(*) FROM media_assets_cl) AS media_assets_total
      `),
      pool.query(`
        SELECT
          c.name AS comuna, t.operation, t.property_type,
          t.enabled, t.interval_hours, t.force_refetch,
          t.last_run_at, t.last_success_at,
          t.last_listing_count, t.portal_reported_count,
          CASE
            WHEN t.last_run_at IS NULL THEN 'nunca'
            WHEN t.last_run_at < now() - make_interval(hours => t.interval_hours * 2) THEN 'atrasado'
            ELSE 'al-dia'
          END AS cadencia
        FROM scrape_targets_cl t
        JOIN chile_comunas c ON c.id = t.comuna_id
        WHERE t.enabled = true
        ORDER BY c.name, t.operation
      `),
      pool.query(`
        SELECT change_type, count(*) AS n
        FROM listing_version_log_cl
        WHERE scraped_at > now() - interval '24 hours'
        GROUP BY change_type ORDER BY n DESC
      `),
      // Misma foto pero de la ÚLTIMA HORA. Sin este contraste, el agregado de 24h
      // no distingue "esto está pasando ahora" de "esto pasó de madrugada y ya se
      // corrigió" — es lo que hacía ilegible el pico de bajas de un barrido roto.
      pool.query(`
        SELECT change_type, count(*) AS n
        FROM listing_version_log_cl
        WHERE scraped_at > now() - interval '1 hour'
        GROUP BY change_type ORDER BY n DESC
      `),
      // Línea de tiempo por hora: deja ver EN QUÉ MOMENTO se produjo un pico y si
      // ya se detuvo, en vez de un número acumulado sin contexto.
      pool.query(`
        SELECT date_trunc('hour', scraped_at) AS hora, change_type, count(*) AS n
        FROM listing_version_log_cl
        WHERE scraped_at > now() - interval '24 hours'
        GROUP BY 1, 2 ORDER BY 1
      `),
    ])

    const c = counts.rows[0]
    const num = (v: unknown) => Number(v ?? 0)

    // Sonda EN VIVO: un fetch real a Portal Inmobiliario por cada objetivo activo,
    // en paralelo, para que "Portal declara" sea el número de AHORA — no el que
    // quedó guardado la última vez que corrió un barrido (que puede tener horas).
    const liveTotals = skipLive
      ? targets.rows.map(() => null)
      : await Promise.all(
          targets.rows.map((t) => probeLivePortalTotal(t.comuna, t.operation, t.property_type))
        )
    const probedAt = new Date().toISOString()

    return NextResponse.json({
      success: true,
      generated_at: new Date().toISOString(),
      totals: {
        listings_total: num(c.listings_total),
        listings_active: num(c.listings_active),
        listings_with_code: num(c.listings_with_code),
        listings_agency_web: num(c.listings_agency_web),
        property_cl_total: num(c.property_cl_total),
        property_cl_en_canje: num(c.property_cl_en_canje),
        corredoras_total: num(c.corredoras_total),
        corredora_webs_enabled: num(c.corredora_webs_enabled),
        media_assets_total: num(c.media_assets_total),
        last_seen_at: c.last_seen_at,
      },
      // Objetivos activos: el corazón del diagnóstico. Si last_run_at es reciente
      // pero last_listing_count=0/bajo → el fetch está fallando (proxy/bloqueo).
      targets: targets.rows.map((t, i) => ({
        comuna: t.comuna,
        operation: t.operation,
        property_type: t.property_type,
        interval_hours: num(t.interval_hours),
        force_refetch: !!t.force_refetch,
        last_run_at: t.last_run_at,
        last_success_at: t.last_success_at,
        last_listing_count: t.last_listing_count == null ? null : num(t.last_listing_count),
        // Histórico (guardado la última vez que corrió un barrido) + EN VIVO
        // (consultado ahora mismo). El frontend usa live_portal_total cuando
        // está disponible; portal_reported_count queda de referencia/fallback.
        portal_reported_count: t.portal_reported_count == null ? null : num(t.portal_reported_count),
        live_portal_total: liveTotals[i],
        live_probed_at: liveTotals[i] != null ? probedAt : null,
        cadencia: t.cadencia,
      })),
      // Pulso de actividad de las últimas 24h (altas, cambios de precio, bajas…).
      activity_24h: versionPulse.rows.map((r) => ({ change_type: r.change_type, count: num(r.n) })),
      // Y el de la última hora: es lo que dice si algo está pasando AHORA.
      activity_1h: versionPulse1h.rows.map((r) => ({ change_type: r.change_type, count: num(r.n) })),
      // Por hora, para situar los picos en el tiempo.
      activity_timeline: timeline.rows.map((r) => ({
        hora: r.hora, change_type: r.change_type, count: num(r.n),
      })),
      // Si esta lectura sondeó el portal o solo leyó la BD (auto-refresco barato).
      live_probed: !skipLive,
    })
  } catch (error) {
    console.error('Error en anuncios-health:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
