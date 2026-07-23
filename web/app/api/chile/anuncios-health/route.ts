import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// /api/chile/anuncios-health — salud del pipeline de Anuncios CL (plan · H17).
// Observabilidad SIN comandos en la VPS: cuántos anuncios crudos, propiedades
// canónicas y corredoras hay, la frescura del último barrido, y el estado de
// cada objetivo de scrape_targets_cl (last_run_at + last_listing_count). Sirve
// para saber de un vistazo si el worker está ingresando datos y, si no, por qué
// (ej. last_run_at reciente pero last_listing_count=0 = fetch fallando).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

// POST → fuerza un re-barrido: pone last_run_at=NULL en los objetivos activos,
// así el discovery-scheduler del worker (que corre cada 15 min y encola los
// objetivos "vencidos") los re-toma en la próxima pasada, sin esperar las 8h de
// cadencia. Útil en la puesta en marcha y para forzar una actualización a mano
// desde el panel, sin comandos en la VPS.
export async function POST() {
  try {
    const { rowCount } = await pool.query(
      `UPDATE scrape_targets_cl SET last_run_at = NULL, updated_at = now() WHERE enabled = true`
    )
    return NextResponse.json({
      success: true,
      requeued: rowCount ?? 0,
      message: `${rowCount ?? 0} objetivo(s) marcados para re-barrido en el próximo ciclo (≤15 min).`,
    })
  } catch (error) {
    console.error('Error forzando re-barrido:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const [counts, targets, versionPulse] = await Promise.all([
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
          t.enabled, t.interval_hours,
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
    ])

    const c = counts.rows[0]
    const num = (v: unknown) => Number(v ?? 0)

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
      targets: targets.rows.map((t) => ({
        comuna: t.comuna,
        operation: t.operation,
        property_type: t.property_type,
        interval_hours: num(t.interval_hours),
        last_run_at: t.last_run_at,
        last_success_at: t.last_success_at,
        last_listing_count: t.last_listing_count == null ? null : num(t.last_listing_count),
        portal_reported_count: t.portal_reported_count == null ? null : num(t.portal_reported_count),
        cadencia: t.cadencia,
      })),
      // Pulso de actividad de las últimas 24h (altas, cambios de precio, bajas…).
      activity_24h: versionPulse.rows.map((r) => ({ change_type: r.change_type, count: num(r.n) })),
    })
  } catch (error) {
    console.error('Error en anuncios-health:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
