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
// PAGINACIÓN. La versión anterior pedía UNA página de listado por operación y
// se quedaba con lo que hubiera: contra los sitios reales eso son 20 fichas de
// 668 en elbarrio.cl, o 9 de 759 en cympropiedades.cl. Ahora recorre el listado
// entero, con tres criterios de parada combinados porque ninguna plataforma
// ofrece los tres (ver crm-adapters/index.mjs):
//   · el total declarado por el sitio (Convecta, Konnect),
//   · la última página que declara su paginador (Konnect),
//   · y SIEMPRE la página vacía o sin fichas nuevas, que es el único criterio
//     que funciona en Ofinet — cuyo paginador solo enseña una ventana de 4
//     páginas aunque haya 85.
// Sobre todo ello manda maxDetails, el tope duro por corrida.
//
// SESIÓN. Ofinet guarda el filtro de búsqueda en la sesión de ASP: la página 2
// pedida sin la cookie de la petición que fijó el filtro devuelve cero fichas.
// Los adaptadores que lo necesitan declaran `requiresSession` y aquí se les
// abre un cookie jar temporal por operación.
// ─────────────────────────────────────────────────────────────────────────────
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchHtmlResilient } from './fetch.mjs'
import { upsertListingCl } from './upsert-listing-cl.mjs'
import { getAdapter } from './crm-adapters/index.mjs'
import { normalizeDomain } from './detect-corredora-crm-cl.mjs'

const DEFAULT_DELAY_MS = 4000     // delay cortés entre requests (H22)
const DEFAULT_MAX_DETAILS = 400   // tope por corrida, para no barrer sitios enteros de golpe
const DEFAULT_MAX_PAGES = 200     // cortafuegos ante un paginador que nunca termina
const OPERATIONS = ['sale', 'rent']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Targets de web `enabled` cuya cadencia (interval_hours) venció. Mismo patrón
 * que selectDueTargets del discovery de PI.
 */
export async function selectDueWebTargets(client, { limit = 20 } = {}) {
  const { rows } = await client.query(
    `SELECT id, domain, base_url, corredora_id, crm_platform, interval_hours
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
 * Recorre el listado de una operación y devuelve las fichas encontradas, sin
 * descargar todavía las páginas de detalle.
 *
 * `seen` viene del caller y es compartido entre operaciones: una ficha
 * publicada a la vez en venta y arriendo aparece en los dos listados y no debe
 * contarse ni descargarse dos veces.
 *
 * @returns {{ items: Array, declaredTotal: number|null, pages: number }}
 */
async function crawlListado(adapter, { domain, baseUrl, operation, seen, limit, deps }) {
  const { fetchImpl, delayMs, maxPages, sleepImpl } = deps
  const items = []
  let declaredTotal = null
  let pages = 0

  // Cookie jar por operación cuando la plataforma guarda el filtro en la sesión
  // (Ofinet): el filtro lo fija la página 1 y las siguientes lo heredan.
  let jarDir = null
  let cookieJar = null
  if (adapter.requiresSession) {
    jarDir = await mkdtemp(join(tmpdir(), 'corredora-web-'))
    cookieJar = join(jarDir, 'cookies.txt')
  }

  // Huella de la página anterior, para detectar un paginador que clampa (pedir
  // la página 99 y recibir siempre la última). NO se puede usar para eso el
  // conjunto global `seen`: una ficha publicada en venta Y arriendo aparece en
  // los dos listados, y las duales suelen ordenarse juntas — cortar el listado
  // de arriendo porque su primera página ya se vio entera en el de venta
  // dejaría fuera el resto del inventario en arriendo.
  let huellaAnterior = null

  try {
    for (let page = 1; page <= maxPages; page++) {
      const url = adapter.listUrl(domain, { operation, page, baseUrl })
      // minLength 1: una página de listado vacía —el final normal del
      // recorrido— son pocos bytes, y tratarla como respuesta corrupta
      // convertía el final del barrido en un error del target.
      const res = await fetchImpl(url, { useProxy: false, profile: 'corredora', cookieJar, minLength: 1 })
      pages++
      await sleepImpl(delayMs)
      if (!res?.ok || !res.html) break

      const { items: pageItems, total, lastPage } = adapter.parseList(res.html, { domain, baseUrl })
      if (total != null) declaredTotal = total

      // Página sin fichas = fin del listado. Es el ÚNICO criterio válido en
      // Ofinet y sirve de red de seguridad en las demás.
      if (pageItems.length === 0) break

      const huella = pageItems.map((it) => it.seller_reference).sort().join(',')
      if (huella === huellaAnterior) break
      huellaAnterior = huella

      for (const it of pageItems) {
        if (items.length >= limit) break
        if (!it.seller_reference || seen.has(it.seller_reference)) continue
        seen.add(it.seller_reference)
        items.push(it)
      }

      if (items.length >= limit) break
      if (lastPage != null && page >= lastPage) break
      if (declaredTotal != null && adapter.pageSize && page * adapter.pageSize >= declaredTotal) break
    }
  } finally {
    if (jarDir) await rm(jarDir, { recursive: true, force: true }).catch(() => {})
  }

  return { items, declaredTotal, pages }
}

/**
 * Crawl de un target de web de corredora. Devuelve un resumen
 * { ok, listings, upserted, declared, reason? }. `deps` inyectables para test:
 *   { fetch, upsert, adapter, enqueueMediaSync, delayMs, maxDetails, maxPages, sleep }
 */
export async function crawlCorredoraWebTarget(client, target, deps = {}) {
  const {
    fetch: fetchImpl = fetchHtmlResilient,
    upsert = upsertListingCl,
    adapter = getAdapter(target.crm_platform),
    enqueueMediaSync = async () => {},
    delayMs = DEFAULT_DELAY_MS,
    maxDetails = DEFAULT_MAX_DETAILS,
    maxPages = DEFAULT_MAX_PAGES,
    sleep: sleepImpl = sleep,
  } = deps

  const domain = normalizeDomain(target.domain)
  const baseUrl = target.base_url ?? null

  if (!adapter) {
    const reason = `sin adaptador para crm_platform='${target.crm_platform}'`
    await markCrawled(client, target.id, { error: reason })
    return { ok: false, reason, listings: 0, upserted: 0, declared: null }
  }

  const corredoraId = await resolveCorredoraId(client, target)

  try {
    // 1) Recorrer los listados (venta + arriendo) hasta agotarlos.
    const seen = new Set()
    const items = []
    let declared = null
    for (const operation of OPERATIONS) {
      if (items.length >= maxDetails) break
      const r = await crawlListado(adapter, {
        domain, baseUrl, operation, seen,
        limit: maxDetails - items.length,
        deps: { fetchImpl, delayMs, maxPages, sleepImpl },
      })
      items.push(...r.items)
      // Los totales declarados por operación se suman: cada listado publica el
      // suyo. Una ficha en venta Y arriendo se cuenta en los dos, así que el
      // declarado puede pasarse por arriba del inventario real — se usa para
      // detectar que el barrido se quedó CORTO, no como cifra exacta.
      if (r.declaredTotal != null) declared = (declared ?? 0) + r.declaredTotal
    }

    // 2) Fichas: upsert. Si el listado ya trae la ficha entera (Konnect), no se
    //    descarga nada más — bajar la página HTML sería una petición por ficha
    //    para obtener MENOS datos de los que ya tenemos.
    let upserted = 0
    for (const item of items.slice(0, maxDetails)) {
      let parsed = item.listing ?? null

      if (!parsed) {
        const res = await fetchImpl(item.url, { useProxy: false, profile: 'corredora' })
        await sleepImpl(delayMs)
        if (!res?.ok || !res.html) continue
        parsed = adapter.parseDetail(res.html, {
          url: item.url,
          domain,
          seller_reference: item.seller_reference,
        })
      }
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

    await markCrawled(client, target.id, { count: items.length, declared })
    return { ok: true, listings: items.length, upserted, declared, corredora_id: corredoraId }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    await markCrawled(client, target.id, { error: reason })
    return { ok: false, reason, listings: 0, upserted: 0, declared: null }
  }
}

async function markCrawled(client, targetId, { count = null, declared = null, error = null } = {}) {
  await client.query(
    `UPDATE corredora_web_targets_cl
        SET last_crawled_at = now(),
            last_success_at = CASE WHEN $2::text IS NULL THEN now() ELSE last_success_at END,
            last_listing_count = COALESCE($3, last_listing_count),
            last_declared_count = COALESCE($4, last_declared_count),
            last_error = $2,
            updated_at = now()
      WHERE id = $1`,
    [targetId, error, count, declared]
  )
}
