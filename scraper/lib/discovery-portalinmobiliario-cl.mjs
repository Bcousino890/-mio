// ─────────────────────────────────────────────────────────────────────────────
// Discovery crawler de Portalinmobiliario (plan Anuncios CL · H1, Fase 1).
//
// La pieza que faltaba de la Fase 1: recorrer el LISTADO de una comuna a escala
// y encolar las fichas nuevas para que el worker (H2) las baje. Es
// config-driven: NO hay comunas hardcodeadas — lee `scrape_targets_cl` (H8) y
// solo barre las filas `enabled` (arranca solo con Las Condes, el resto de la RM
// se activa con un UPDATE, sin tocar código).
//
// Para cada target (comuna × tipo × operación) construye la URL de listado de
// PROPIEDADES USADAS (el plan cubre primero usadas, no proyectos), pagina con el
// patrón real `_Desde_N` confirmado en Fase 0, extrae los anuncios con
// parseListPage (blob Nordic) y:
//   - encola `detail:<id>` SOLO de los external_id que aún no están en
//     listings_cl (los ya conocidos los refresca el propio ciclo de detail).
//   - al terminar un barrido COMPLETO de la comuna, marca `delisted` los
//     anuncios activos que ya no aparecieron (detección de baja, H2) — esto vive
//     aquí a propósito: upsert-listing-cl.mjs solo actúa con datos frescos de una
//     ficha, no puede saber que un anuncio DEJÓ de estar.
//   - actualiza los contadores del target (last_run_at, cobertura vs el total
//     declarado por el portal, base del gate ≥90% de H17/H22).
//
// Toda la lógica de decisión (slug de comuna, armado de URL, terminación de la
// paginación) es PURA y testeable sin red ni Postgres; discoverTarget inyecta
// fetch/parse/enqueue para poder testear el barrido con páginas simuladas.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchHtmlResilient, SLEEP } from './fetch.mjs'
import { parseListPage, parseListMeta } from './parse-portalinmobiliario.mjs'
import { fold } from './chile-comunas.mjs'

const PAGE_SIZE = 48 // confirmado en Fase 0: 48 resultados por página (_Desde_49, _Desde_97…)

// Bisección por banda de precio (para comunas que superan el tope de paginación
// del portal, ~2000). Techo alto en CLP que cubre cualquier residencial chileno
// (≈ USD 10M); el tramo por encima se barre como banda abierta [techo, ∞).
const PRICE_CEILING_CLP = 10_000_000_000
const MAX_PRICE_DEPTH = 8            // 2^8 = 256 bandas máx: sobra para cualquier comuna
const MIN_BAND_WIDTH_CLP = 10_000_000 // no bisecar por debajo de 10M CLP de ancho

/** operación interna → segmento de URL de Portalinmobiliario. */
export function operationSlug(operation) {
  return operation === 'rent' ? 'arriendo' : 'venta'
}

/** "Las Condes" → "las-condes", "Ñuñoa" → "nunoa" (sin acentos, espacios→guiones). */
export function comunaSlug(name) {
  return fold(String(name ?? ''))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Segmento de región para la URL. El piloto es RM y el portal la escribe
 * "metropolitana" (`las-condes-metropolitana`). Se deriva del nombre de región
 * de chile_comunas; para RM (único scope habilitado) queda confirmado.
 */
export function regionSlug(region) {
  const f = fold(String(region ?? ''))
  if (f.includes('metropolitana')) return 'metropolitana'
  // Otras regiones aún no validadas contra el portal (fuera del scope del piloto):
  // se usa la última palabra folded como mejor esfuerzo.
  const parts = f.replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
  return parts[parts.length - 1] || 'metropolitana'
}

/**
 * Sufijo de filtro de banda de precio de Portalinmobiliario, en CLP. `0` = sin
 * límite (así lo escribe el propio portal: `_PriceRange_1000000000CLP-0CLP` =
 * "más de mil millones"). Filtra TODAS las publicaciones convirtiendo UF→CLP,
 * así que la unión de bandas cubre el 100% de la comuna (verificado: las bandas
 * nativas de Las Condes suman exactamente su total). `null` = sin filtro.
 */
export function priceRangeSegment(priceRange) {
  if (!priceRange) return ''
  const { minClp = 0, maxClp = 0 } = priceRange
  return `/_PriceRange_${Math.round(minClp)}CLP-${Math.round(maxClp)}CLP`
}

/**
 * URL de una página de listado de propiedades USADAS. `offset` en {0,48,96,…};
 * la página 1 (offset 0) no lleva sufijo, el resto usa `/_Desde_{offset+1}_NoIndex_True`.
 * `priceRange` opcional ({minClp,maxClp}) añade el filtro de banda de precio, que
 * PI apila ANTES del sufijo de paginación.
 */
export function buildListUrl({ comunaSlug: slug, regionSlug: rslug, operation, propertyType, offset = 0, priceRange = null }) {
  const type = fold(String(propertyType ?? 'casa')) || 'casa'
  let url = `https://www.portalinmobiliario.com/${operationSlug(operation)}/${type}/propiedades-usadas/${slug}-${rslug}`
  url += priceRangeSegment(priceRange)
  if (offset > 0) url += `/_Desde_${offset + 1}_NoIndex_True`
  return url
}

/**
 * Decide si seguir paginando tras procesar la página `page`. Puro.
 * - Se detiene si la página vino vacía (fin real de resultados).
 * - Se detiene al alcanzar `pageCount` (del blob) — barrido COMPLETO.
 * - Se detiene al tope de seguridad `maxPages`; si ese tope corta ANTES de
 *   `pageCount`, el barrido queda INCOMPLETO (no se marcarán bajas).
 *
 * @returns {{ stop: boolean, completed: boolean, reason: string|null }}
 */
export function decideContinue({ page, pageItems, pageCount, maxPages }) {
  if (pageItems === 0) return { stop: true, completed: true, reason: null }
  if (pageCount != null && page >= pageCount) return { stop: true, completed: true, reason: null }
  if (page >= maxPages) {
    const capBelowTotal = pageCount != null && page < pageCount
    return {
      stop: true,
      completed: !capBelowTotal,
      reason: capBelowTotal ? `tope maxPages=${maxPages} < pageCount=${pageCount}` : null,
    }
  }
  return { stop: false, completed: false, reason: null }
}

/** external_id ya presentes en listings_cl (para no re-encolar detail de lo conocido). */
async function existingExternalIds(client, externalIds) {
  if (externalIds.length === 0) return new Set()
  const { rows } = await client.query(
    `SELECT external_id FROM listings_cl
     WHERE portal = 'portalinmobiliario' AND external_id = ANY($1::text[])`,
    [externalIds]
  )
  return new Set(rows.map((r) => r.external_id))
}

/**
 * Detección de baja (H2): tras un barrido COMPLETO, los anuncios activos de este
 * (comuna, operación, tipo) en el portal que NO reaparecieron pasan a
 * is_active=false + taken_down_at, con su fila 'delisted' en el version_log.
 * Solo se llama con `seenExternalIds` NO vacío (un barrido completo que devuelve
 * 0 resultados es sospechoso → se omite para no dar de baja media comuna por un fallo).
 */
async function markDelisted(client, target, seenExternalIds, scrapedAt) {
  const { rows } = await client.query(
    `SELECT id FROM listings_cl
     WHERE portal = 'portalinmobiliario' AND is_active = true
       AND comuna_id = $1 AND operation = $2 AND property_type = $3
       AND NOT (external_id = ANY($4::text[]))`,
    [target.comuna_id, target.operation, target.property_type, [...seenExternalIds]]
  )
  if (rows.length === 0) return 0
  const ids = rows.map((r) => r.id)
  await client.query(
    `UPDATE listings_cl SET is_active = false, taken_down_at = $2, updated_at = now()
     WHERE id = ANY($1::uuid[])`,
    [ids, scrapedAt]
  )
  await client.query(
    `INSERT INTO listing_version_log_cl (listing_id, scraped_at, change_type)
     SELECT unnest($1::uuid[]), $2, 'delisted'
     ON CONFLICT (listing_id, scraped_at) DO NOTHING`,
    [ids, scrapedAt]
  )
  return ids.length
}

async function updateTargetStats(client, targetId, { scrapedAt, completed, listingCount, portalTotal }) {
  await client.query(
    `UPDATE scrape_targets_cl SET
       last_run_at = $2,
       last_success_at = CASE WHEN $3 THEN $2 ELSE last_success_at END,
       last_listing_count = $4,
       portal_reported_count = COALESCE($5, portal_reported_count),
       updated_at = now()
     WHERE id = $1`,
    [targetId, scrapedAt, completed, listingCount, portalTotal]
  )
}

/**
 * Barre una comuna (un target de scrape_targets_cl) de punta a punta.
 *
 * @param {import('pg').Client} client
 * @param {{ id:string, comuna_id:string, comuna_name:string, region:string, operation:'sale'|'rent', property_type:string }} target
 * @param {object} [deps] inyectables para test
 * @returns {Promise<{ target_id, pages, seen, enqueued, delisted, portal_total, completed, reason }>}
 */
/**
 * Barre UNA banda (una URL de listado, opcionalmente con filtro de precio) hasta
 * agotar su paginación. Acumula en `seen` los external_id y encola detail de los
 * nuevos. NO da de baja ni actualiza stats — eso lo hace el orquestador sobre el
 * agregado de todas las bandas. Devuelve el estado de esta banda.
 */
async function sweepBand(client, ctx, priceRange, seen) {
  const { fetch, parseList, parseMeta, enqueueDetail, maxPages, politenessMs, sleep, includeDevelopments, target } = ctx
  let pages = 0, enqueued = 0, portalTotal = null, resultsLimit = null, completed = false, reason = null

  for (let page = 1; page <= maxPages; page++) {
    const offset = (page - 1) * PAGE_SIZE
    const url = buildListUrl({ comunaSlug: ctx.slug, regionSlug: ctx.rslug, operation: target.operation, propertyType: target.property_type, offset, priceRange })

    const res = await fetch(url, { profile: 'portalinmobiliario' })
    if (!res.ok) {
      if (page === 1 && (res.status === 404 || /\b404\b/.test(res.reason ?? ''))) {
        completed = true; reason = 'sin inventario (404)'
      } else {
        reason = `fetch p${page}: ${res.reason ?? 'fallo'}`
      }
      break
    }
    pages++

    const meta = parseMeta(res.html)
    const listings = parseList(res.html)
    if (page === 1) { portalTotal = meta.total; resultsLimit = meta.resultsLimit }

    const usable = includeDevelopments ? listings : listings.filter((l) => !l.is_development)
    for (const l of usable) seen.add(l.external_id)

    const ids = usable.map((l) => l.external_id)
    const known = await existingExternalIds(client, ids)
    for (const l of usable) {
      if (!known.has(l.external_id)) { await enqueueDetail(l.external_id, l.source_url); enqueued++ }
    }

    const d = decideContinue({ page, pageItems: listings.length, pageCount: meta.pageCount, maxPages })
    if (d.stop) { completed = d.completed; reason = reason ?? d.reason; break }
    await sleep(politenessMs)
  }

  const capped = portalTotal != null && resultsLimit != null && portalTotal > resultsLimit
  return { pages, enqueued, portalTotal, resultsLimit, completed, capped, reason }
}

/**
 * Bisección recursiva por precio: parte una banda [minClp,maxClp] hasta que cada
 * sub-banda esté bajo el tope de paginación del portal. `probe(range)` devuelve
 * el `total` que el portal declara para esa banda. Puro respecto a la red (recibe
 * `probe` inyectable). Devuelve las bandas hoja a barrer.
 *
 * Colina (5699, banda alta 2118 > 2000) es justo el caso: la banda que aún topa
 * se subdivide sola, sin listas de barrios ni tope por comuna.
 */
export async function subdividePriceBands(probe, resultsLimit, minClp = 0, maxClp = PRICE_CEILING_CLP, depth = 0) {
  const total = await probe({ minClp, maxClp })
  // Sin dato o ya bajo el tope: es una banda hoja.
  if (total == null || total <= resultsLimit) return [{ minClp, maxClp }]
  // No se puede seguir partiendo (profundidad/ancho mínimo): se barre igual
  // (topará, pero es el mejor esfuerzo — caso extremo improbable).
  if (depth >= MAX_PRICE_DEPTH || (maxClp - minClp) <= MIN_BAND_WIDTH_CLP) return [{ minClp, maxClp }]
  const mid = minClp + Math.floor((maxClp - minClp) / 2)
  const lower = await subdividePriceBands(probe, resultsLimit, minClp, mid, depth + 1)
  const upper = await subdividePriceBands(probe, resultsLimit, mid, maxClp, depth + 1)
  return [...lower, ...upper]
}

export async function discoverTarget(client, target, deps = {}) {
  const {
    fetch = fetchHtmlResilient,
    parseList = parseListPage,
    parseMeta = parseListMeta,
    enqueueDetail = async () => {},
    maxPages = 60,
    politenessMs = 1500,
    sleep = SLEEP,
    includeDevelopments = false,
    now = () => new Date(),
  } = deps

  const slug = comunaSlug(target.comuna_name)
  const rslug = regionSlug(target.region)
  const scrapedAt = now()
  const ctx = { fetch, parseList, parseMeta, enqueueDetail, maxPages, politenessMs, sleep, includeDevelopments, target, slug, rslug }

  const seen = new Set()
  let pages = 0, enqueued = 0, portalTotal = null, resultsLimit = null, reason = null
  let bandsUsed = 1
  let allBandsExhaustive = true

  // Barrido sin filtro. Si la comuna cabe bajo el tope, con esto basta.
  const base = await sweepBand(client, ctx, null, seen)
  pages += base.pages; enqueued += base.enqueued
  portalTotal = base.portalTotal; resultsLimit = base.resultsLimit; reason = base.reason
  let completed = base.completed

  if (base.capped) {
    // Comuna por encima del tope: subdividir por precio. Cada banda se barre
    // ENTERA; su unión cubre el 100% de la comuna. Los 2000 ya vistos en el
    // barrido base se re-ven en sus bandas (dedup natural por el Set `seen`).
    const probe = async (range) => {
      const url = buildListUrl({ comunaSlug: slug, regionSlug: rslug, operation: target.operation, propertyType: target.property_type, priceRange: range })
      const res = await fetch(url, { profile: 'portalinmobiliario' })
      if (!res.ok) return null
      await sleep(politenessMs)
      return parseMeta(res.html).total
    }
    const bands = await subdividePriceBands(probe, resultsLimit ?? 2000)
    bandsUsed = bands.length
    completed = true
    for (const band of bands) {
      const r = await sweepBand(client, ctx, band, seen)
      pages += r.pages; enqueued += r.enqueued
      if (!r.completed || r.capped) { allBandsExhaustive = false; completed = false }
      await sleep(politenessMs)
    }
    reason = `comuna topó paginación (total=${portalTotal}): subdividida en ${bandsUsed} bandas de precio`
  }

  // Exhaustivo (seguro para dar de baja) = barrido base completo y no topado, o
  // banda-por-banda con TODAS las bandas completas (unión = 100% de la comuna).
  const exhaustive = base.capped
    ? (completed && allBandsExhaustive)
    : (completed && !base.capped)

  let delisted = 0
  if (exhaustive && target.comuna_id && seen.size > 0) {
    delisted = await markDelisted(client, target, seen, scrapedAt)
  }

  await updateTargetStats(client, target.id, { scrapedAt, completed, listingCount: seen.size, portalTotal })

  return { target_id: target.id, pages, seen: seen.size, enqueued, delisted, portal_total: portalTotal, results_limit: resultsLimit, bands: bandsUsed, completed, exhaustive, capped: base.capped, reason }
}

/**
 * Selecciona los targets `enabled` cuya cadencia venció (last_run_at más viejo
 * que interval_hours) — el scheduler del worker encola un discovery por cada uno.
 * Devuelve el payload listo para el job (con comuna_name/region ya resueltos).
 */
export async function selectDueTargets(client, { limit = 50 } = {}) {
  const { rows } = await client.query(
    `SELECT t.id, t.comuna_id, c.name AS comuna_name, c.region,
            t.operation, t.property_type
     FROM scrape_targets_cl t
     JOIN chile_comunas c ON c.id = t.comuna_id
     WHERE t.enabled = true
       AND (t.last_run_at IS NULL
            OR t.last_run_at < now() - make_interval(hours => t.interval_hours))
     ORDER BY t.priority ASC, t.last_run_at ASC NULLS FIRST
     LIMIT $1`,
    [limit]
  )
  return rows
}
