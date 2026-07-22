// ─────────────────────────────────────────────────────────────────────────────
// crawl-corredora-web-cl.mjs — crawl de la web propia de una corredora
// (plan Anuncios CL · Fase 4 / H21). Cierra la Fase 4 de punta a punta: descarga
// las fichas de la web propia y las inserta como listings_cl (source_type
// 'agency_web'), para que el enlace determinista Nivel 1.5
// (link-internal-code-cl.mjs) las una al anuncio de PI de la misma corredora por
// código interno.
//
// Es a corredora_web_targets_cl (0069) lo que discovery-portalinmobiliario-cl.mjs
// es a scrape_targets_cl: config-driven, un target por dominio, cadencia por fila.
//
// RATE-LIMIT SUAVE (H22): son sitios pequeños de bajo tráfico. Concurrencia 1
// (bucle secuencial), delay generoso entre requests, y SIN proxy (no hay que
// esconder volumen bajo; además el fetch directo es el que funciona contra estos
// dominios — el proxy del sandbox recibía 503). Distinto del perfil de PI.
//
// AJAX: si el listado se carga por JS, adapter.parseList devuelve [] → el crawl
// registra cobertura 0 y sigue sin romper. El endpoint XHR real (o un navegador
// acotado) es un incremento posterior; el enlace básico PI↔web-propia no lo
// necesita (opera sobre la ficha individual, que suele ser HTML estático).
// ─────────────────────────────────────────────────────────────────────────────
import { fetchHtmlResilient } from './fetch.mjs'
import { upsertListingCl } from './upsert-listing-cl.mjs'
import { getAdapter } from './crm-adapters/index.mjs'
import { normalizeDomain } from './detect-corredora-crm-cl.mjs'

const DEFAULT_DELAY_MS = 4000     // delay cortés entre requests (H22)
const DEFAULT_MAX_DETAILS = 120   // tope por corrida, para no barrer sitios enteros de golpe
const OPERATIONS = ['sale', 'rent']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Targets de web `enabled` cuya cadencia (interval_hours) venció. Mismo patrón
 * que selectDueTargets del discovery de PI.
 */
export async function selectDueWebTargets(client, { limit = 20 } = {}) {
  const { rows } = await client.query(
    `SELECT id, domain, corredora_id, crm_platform, interval_hours
       FROM corredora_web_targets_cl
      WHERE enabled = true
        AND (last_crawled_at IS NULL
             OR last_crawled_at < now() - make_interval(hours => interval_hours))
      ORDER BY priority ASC, last_crawled_at ASC NULLS FIRST
      LIMIT $1`,
    [limit]
  )
  return rows
}

/**
 * Resuelve la corredora dueña de un dominio. Usa target.corredora_id si ya está;
 * si no, la busca en corredoras_cl por web_propia_url y, si la encuentra,
 * rellena el FK del target (backfill del enlace web→corredora). Devuelve el id o
 * null. El id es imprescindible para que el Nivel 1.5 empareje web ↔ PI (ambos
 * lados unen por corredora_id).
 */
async function resolveCorredoraId(client, target) {
  if (target.corredora_id) return target.corredora_id
  const domain = normalizeDomain(target.domain)
  const { rows } = await client.query(
    `SELECT id FROM corredoras_cl
      WHERE web_propia_url IS NOT NULL
        AND lower(regexp_replace(web_propia_url, '^https?://(www\\.)?', '')) LIKE $1
      ORDER BY active_listings_count DESC NULLS LAST
      LIMIT 1`,
    [`${domain}%`]
  )
  const corredoraId = rows[0]?.id ?? null
  if (corredoraId) {
    await client.query(
      `UPDATE corredora_web_targets_cl SET corredora_id = $1, updated_at = now() WHERE id = $2`,
      [corredoraId, target.id]
    )
  }
  return corredoraId
}

/**
 * Crawl de un target de web de corredora. Devuelve un resumen
 * { ok, listings, upserted, links, reason? }. `deps` inyectables para test:
 *   { fetch, upsert, adapter, enqueueMediaSync, delayMs, maxDetails, sleep }
 */
export async function crawlCorredoraWebTarget(client, target, deps = {}) {
  const {
    fetch: fetchImpl = fetchHtmlResilient,
    upsert = upsertListingCl,
    adapter = getAdapter(target.crm_platform),
    enqueueMediaSync = async () => {},
    delayMs = DEFAULT_DELAY_MS,
    maxDetails = DEFAULT_MAX_DETAILS,
    sleep: sleepImpl = sleep,
  } = deps

  const domain = normalizeDomain(target.domain)

  if (!adapter) {
    const reason = `sin adaptador para crm_platform='${target.crm_platform}'`
    await markCrawled(client, target.id, { error: reason })
    return { ok: false, reason, listings: 0, upserted: 0, links: 0 }
  }

  const corredoraId = await resolveCorredoraId(client, target)

  try {
    // 1) Descubrir URLs de ficha desde los listados (venta + arriendo).
    const detailUrls = new Set()
    for (const operation of OPERATIONS) {
      const url = adapter.listUrl(domain, { operation })
      const res = await fetchImpl(url, { useProxy: false })
      if (res?.ok && res.html) {
        for (const { url: durl } of adapter.parseList(res.html, { domain })) detailUrls.add(durl)
      }
      await sleepImpl(delayMs)
      if (detailUrls.size >= maxDetails) break
    }

    // 2) Fetch + parse + upsert de cada ficha (rate-limit suave, secuencial).
    let upserted = 0
    const urls = [...detailUrls].slice(0, maxDetails)
    for (const durl of urls) {
      const res = await fetchImpl(durl, { useProxy: false })
      await sleepImpl(delayMs)
      if (!res?.ok || !res.html) continue
      const parsed = adapter.parseDetail(res.html, { url: durl, domain })
      if (!parsed) continue

      const { listingId } = await upsert(client, parsed)
      // upsertListingCl no toca corredora_id (las webs propias no traen
      // advertiser_id de ML) → lo fijamos aquí, que es lo que engancha el Nivel 1.5.
      if (corredoraId) {
        await client.query(
          `UPDATE listings_cl SET corredora_id = $1, updated_at = now()
            WHERE id = $2 AND corredora_id IS DISTINCT FROM $1`,
          [corredoraId, listingId]
        )
      }
      upserted++
      if (Array.isArray(parsed.photos) && parsed.photos.length > 0) await enqueueMediaSync(listingId)
    }

    await markCrawled(client, target.id, { count: urls.length })
    return { ok: true, listings: urls.length, upserted, corredora_id: corredoraId }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    await markCrawled(client, target.id, { error: reason })
    return { ok: false, reason, listings: 0, upserted: 0 }
  }
}

async function markCrawled(client, targetId, { count = null, error = null } = {}) {
  await client.query(
    `UPDATE corredora_web_targets_cl
        SET last_crawled_at = now(),
            last_success_at = CASE WHEN $2::text IS NULL THEN now() ELSE last_success_at END,
            last_listing_count = COALESCE($3, last_listing_count),
            last_error = $2,
            updated_at = now()
      WHERE id = $1`,
    [targetId, error, count]
  )
}
