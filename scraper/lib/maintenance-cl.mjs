// ─────────────────────────────────────────────────────────────────────────────
// Correcciones de datos puntuales de Chile (property_cl + fichas ya guardadas),
// reutilizables desde la CLI (rebuild-property-cl-cl.mjs / backfill-…) y desde el
// arranque del worker (runStartupFixesCl, una sola vez, marcadas en data_fixes_cl).
//
//  1. rebuildPropertyClCl: reconstruye property_cl desde cero con la ÚNICA regla
//     de deduplicación vigente (decisión del usuario): agrupar SOLO si coinciden
//     corredora (advertiser_id) Y código interno (seller_reference). Nunca por
//     matching difuso/probabilístico — de ahí que use exclusivamente
//     runNivel1DedupCl (que ya cubre tanto los grupos como los anuncios sin
//     código interno, 1 aviso = 1 ficha). property_cl es DERIVADA (solo
//     listings_cl la referencia, con ON DELETE SET NULL), así que borrarla y
//     re-derivarla no pierde datos crudos.
//  2. backfillSuperficieFotosCl: re-scrapea fichas cuya superficie es claramente
//     el terreno filtrado (casa/depto con square_meters ≥ umbral) para que el
//     parser corregido recalcule superficie construida + deduplique fotos, y
//     refresca los agregados del property_cl afectado.
// ─────────────────────────────────────────────────────────────────────────────

import pg from 'pg'
import {
  runNivel1DedupCl,
  runCorredoraConsolidationCl,
  refreshPropertyClAggregates,
} from './dedup-cl.mjs'
import { fetchHtmlResilient, SLEEP } from './fetch.mjs'
import { parseDetailPage } from './parse-portalinmobiliario.mjs'
import { upsertListingCl } from './upsert-listing-cl.mjs'
import { getUfRateCl } from './uf-rate-cl.mjs'

const NOOP_LOG = () => {}

// Lock consultivo de Postgres para serializar la reconstrucción de property_cl
// con el pipeline periódico de dedup (dedup-cluster). Sin esto, el DELETE/INSERT
// masivo de property_cl del rebuild y los INSERT de Nivel 1 del job periódico
// pueden interbloquearse (ordenan sus locks al revés). El job periódico usa
// pg_try_advisory_lock y se salta la corrida si el rebuild lo tiene tomado.
export const DEDUP_ADVISORY_LOCK_KEY = 4201

async function drain(fn, client) {
  let created = 0, linked = 0, rounds = 0
  for (;;) {
    const r = await fn(client)
    const processed = r.groups_processed ?? r.advertisers_processed ?? 0
    created += r.created; linked += r.linked; rounds++
    if (processed === 0) break
  }
  return { created, linked, rounds }
}

/** Diagnóstico: total de property_cl y cuántos sospechan fusión indebida. */
export async function diagnosePropertyCl(client) {
  const total = await client.query(`SELECT count(*)::int AS n FROM property_cl`)
  const overMerged = await client.query(
    `SELECT count(*)::int AS n FROM (
       SELECT p.id FROM property_cl p JOIN listings_cl l ON l.property_cl_id = p.id
       GROUP BY p.id
       HAVING count(DISTINCT l.property_code) FILTER (WHERE l.property_code IS NOT NULL) > 1
     ) q`
  )
  return { total: total.rows[0].n, overMerged: overMerged.rows[0].n }
}

/**
 * Reconstruye property_cl desde cero con la regla vigente (Nivel 1: corredora +
 * código interno), en UNA transacción. Idempotente.
 */
export async function rebuildPropertyClCl(client, { log = NOOP_LOG } = {}) {
  // Serializa con el dedup periódico (evita deadlock por orden de locks inverso).
  await client.query('SELECT pg_advisory_lock($1)', [DEDUP_ADVISORY_LOCK_KEY])
  try {
    return await rebuildPropertyClInner(client, { log })
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [DEDUP_ADVISORY_LOCK_KEY])
  }
}

async function rebuildPropertyClInner(client, { log }) {
  const before = await diagnosePropertyCl(client)
  log(`[rebuild] antes: ${before.total} property_cl, ${before.overMerged} sospechosos de fusión indebida`)

  await client.query('BEGIN')
  try {
    // Solo se resetean los anuncios NO fijados a mano (migración 0079). Los
    // `manual_property_lock` mantienen su property_cl_id intacto — es la
    // decisión curada del equipo, y runNivel1DedupCl ya sabe reusar esa ficha
    // como ancla cuando reprocesa el grupo.
    await client.query(
      `UPDATE listings_cl SET property_cl_id = NULL, match_confidence = NULL
       WHERE property_cl_id IS NOT NULL AND NOT manual_property_lock`
    )
    // Solo se borran las fichas que quedaron SIN NINGÚN anuncio (ni siquiera uno
    // fijado a mano) — nunca las que un lock sigue anclando. `property_cl_id`
    // tiene ON DELETE SET NULL: borrar una ficha con anuncios fijados los
    // desancla igual, aunque el UPDATE de arriba no los haya tocado.
    await client.query(
      `DELETE FROM property_cl p
       WHERE NOT EXISTS (SELECT 1 FROM listings_cl l WHERE l.property_cl_id = p.id)`
    )
    const n1 = await drain(runNivel1DedupCl, client)
    await drain(runCorredoraConsolidationCl, client)
    await client.query('COMMIT')
    const after = await diagnosePropertyCl(client)
    log(`[rebuild] listo: ${before.total} → ${after.total} property_cl (Nivel1 ${n1.created}); fusiones indebidas ${before.overMerged} → ${after.overMerged}`)
    return { before, after, nivel1: n1.created }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  }
}

/** Re-scrapea UNA ficha (fetch resiliente + parser corregido + upsert). Sin media-sync. */
async function rescrapeListing(client, { externalId, sourceUrl }) {
  const url = sourceUrl ?? `https://www.portalinmobiliario.com/${externalId}`
  const res = await fetchHtmlResilient(url, { profile: 'portalinmobiliario' })
  if (!res.ok) return { ok: false, reason: res.reason }
  const parsed = await parseDetailPage(res.html, externalId)
  if (!parsed) return { ok: false, reason: 'parse_failed' }
  if (sourceUrl && /portalinmobiliario\.com\/MLC-?\d+-/.test(sourceUrl)) parsed.source_url = sourceUrl
  const uf = await getUfRateCl()
  const opts = uf.ok ? { ufRate: uf.rate, ufRateDate: uf.date } : {}
  const { listingId, changeType } = await upsertListingCl(client, parsed, opts)
  return { ok: true, listingId, changeType, propertyCode: parsed.property_code ?? null }
}

/** Candidatos con superficie sospechosa (terreno filtrado como m²) o, con `all`, todos los activos. */
async function backfillCandidates(client, { minSqm, all, limit }) {
  if (all) {
    const { rows } = await client.query(
      `SELECT id, external_id, source_url, property_cl_id, square_meters
       FROM listings_cl
       WHERE portal = 'portalinmobiliario' AND is_active AND source_url IS NOT NULL
       ORDER BY square_meters DESC NULLS LAST ${limit ? 'LIMIT $1' : ''}`,
      limit ? [limit] : [],
    )
    return rows
  }
  const values = [minSqm]
  if (limit) values.push(limit)
  const { rows } = await client.query(
    `SELECT id, external_id, source_url, property_cl_id, square_meters
     FROM listings_cl
     WHERE portal = 'portalinmobiliario' AND is_active AND source_url IS NOT NULL
       AND square_meters IS NOT NULL AND square_meters >= $1
       AND (property_type IN ('casa','departamento') OR property_type IS NULL)
     ORDER BY square_meters DESC ${limit ? 'LIMIT $2' : ''}`,
    values,
  )
  return rows
}

/**
 * Re-scrapea fichas con superficie/fotos viejas y refresca los agregados del
 * property_cl afectado. Rate-limited (sleepMs). Idempotente: el set de candidatos
 * (square_meters ≥ minSqm) se encoge solo a medida que se corrigen.
 */
export async function backfillSuperficieFotosCl(client, {
  minSqm = 2000, all = false, limit = null, sleepMs = 1500, log = NOOP_LOG,
} = {}) {
  const candidates = await backfillCandidates(client, { minSqm, all, limit })
  log(`[backfill] ${candidates.length} ficha(s) a re-scrapear ${all ? '(todas)' : `(square_meters ≥ ${minSqm})`}`)

  let ok = 0, failed = 0
  const touchedProps = new Set()
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    try {
      const res = await rescrapeListing(client, { externalId: c.external_id, sourceUrl: c.source_url })
      if (res.ok) ok++; else { failed++; log(`[backfill] ${c.external_id}: ${res.reason}`) }
    } catch (e) {
      failed++; log(`[backfill] ${c.external_id}: ${e.message}`)
    }
    if (c.property_cl_id) touchedProps.add(c.property_cl_id)
    if (i < candidates.length - 1) await SLEEP(sleepMs)
  }

  let refreshed = 0
  for (const pid of touchedProps) {
    try { await refreshPropertyClAggregates(client, pid); refreshed++ } catch { /* grupo pudo desaparecer */ }
  }
  log(`[backfill] listo: ${ok} re-scrapeados, ${failed} fallidos, ${refreshed} property_cl refrescados`)
  return { candidates: candidates.length, ok, failed, refreshed }
}

/**
 * Re-scrapea fichas de Portal Inmobiliario que quedaron SIN `property_code`
 * ("Código de la propiedad") para que el parser corregido —que ahora también lo
 * lee del DOM, no solo del blob Nordic— lo rellene, y refresca los agregados del
 * property_cl afectado. Rate-limited (sleepMs). Idempotente: el set de
 * candidatos (property_code IS NULL) se encoge solo a medida que se rellenan.
 *
 * NOTA: el enlace por property_code (Nivel 1) lo hace el pipeline de dedup
 * aparte; este backfill solo repuebla el dato crudo del anuncio.
 */
export async function backfillPropertyCodeCl(client, {
  limit = null, sleepMs = 1500, log = NOOP_LOG,
} = {}) {
  const { rows: candidates } = await client.query(
    `SELECT id, external_id, source_url, property_cl_id
     FROM listings_cl
     WHERE portal = 'portalinmobiliario' AND is_active
       AND source_url IS NOT NULL AND property_code IS NULL
     ORDER BY last_seen_at DESC NULLS LAST ${limit ? 'LIMIT $1' : ''}`,
    limit ? [limit] : [],
  )
  log(`[backfill-code] ${candidates.length} ficha(s) sin property_code a re-scrapear`)

  let ok = 0, failed = 0, filled = 0
  const touchedProps = new Set()
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    try {
      const res = await rescrapeListing(client, { externalId: c.external_id, sourceUrl: c.source_url })
      if (res.ok) {
        ok++
        if (res.propertyCode != null) { filled++; if (c.property_cl_id) touchedProps.add(c.property_cl_id) }
      } else {
        failed++; log(`[backfill-code] ${c.external_id}: ${res.reason}`)
      }
    } catch (e) {
      failed++; log(`[backfill-code] ${c.external_id}: ${e.message}`)
    }
    if (i < candidates.length - 1) await SLEEP(sleepMs)
  }

  let refreshed = 0
  for (const pid of touchedProps) {
    try { await refreshPropertyClAggregates(client, pid); refreshed++ } catch { /* grupo pudo desaparecer */ }
  }
  log(`[backfill-code] listo: ${ok} re-scrapeados, ${filled} con código nuevo, ${failed} fallidos, ${refreshed} property_cl refrescados`)
  return { candidates: candidates.length, ok, filled, failed, refreshed }
}

// ─── Orquestador de arranque (una sola vez, marcado en data_fixes_cl) ─────────

async function ensureFixMarkerTable(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS data_fixes_cl (
    name       text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now(),
    detail     jsonb
  )`)
}
async function isApplied(client, name) {
  const { rows } = await client.query(`SELECT 1 FROM data_fixes_cl WHERE name = $1`, [name])
  return rows.length > 0
}
async function markApplied(client, name, detail) {
  await client.query(
    `INSERT INTO data_fixes_cl (name, detail) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
    [name, detail ? JSON.stringify(detail) : null],
  )
}

// Nombres de las correcciones one-shot. Cambiar el sufijo fuerza re-ejecución.
export const FIX_REBUILD = 'rebuild-property-cl-v1'
export const FIX_BACKFILL = 'backfill-superficie-fotos-v1'

/**
 * Corre las correcciones pendientes UNA sola vez. Crea su PROPIA conexión (no
 * comparte el pg.Client del worker: las transacciones no deben envolver las
 * queries de las colas). Nunca lanza — loguea y sigue. Pensado para llamarse en
 * segundo plano al arrancar el worker (fire-and-forget).
 */
export async function runStartupFixesCl({ log = console.log } = {}) {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) { log('[startup-fix] sin DATABASE_URL — omitido'); return }

  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await ensureFixMarkerTable(client)

    if (!(await isApplied(client, FIX_REBUILD))) {
      log('[startup-fix] reconstruyendo property_cl (una vez)…')
      try {
        const r = await rebuildPropertyClCl(client, { log })
        await markApplied(client, FIX_REBUILD, r)
      } catch (e) { log(`[startup-fix] rebuild falló (se reintenta al próximo arranque): ${e.message}`) }
    }

    if (!(await isApplied(client, FIX_BACKFILL))) {
      log('[startup-fix] backfill superficie/fotos (una vez)…')
      try {
        // sleep alto: comparte el portal con la cola detail-cl del worker.
        const r = await backfillSuperficieFotosCl(client, { log, sleepMs: 2500 })
        await markApplied(client, FIX_BACKFILL, r)
      } catch (e) { log(`[startup-fix] backfill falló (se reintenta al próximo arranque): ${e.message}`) }
    }
  } finally {
    await client.end()
  }
}
