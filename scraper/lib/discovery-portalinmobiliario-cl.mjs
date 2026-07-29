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
// del portal, ~2000). Techo alto que cubre cualquier residencial chileno; el
// tramo por encima se barre como banda abierta [techo, ∞).
const PRICE_CEILING_CLP = 10_000_000_000
const MAX_PRICE_DEPTH = 8            // 2^8 = 256 bandas máx: sobra para cualquier comuna
const MIN_BAND_WIDTH_CLP = 10_000_000 // no bisecar por debajo de 10M CLP de ancho

// VENTA: el portal filtra y muestra el precio en UF (Unidad de Fomento) — es la
// moneda en la que casi toda propiedad en venta se publica en Chile. Verificado
// en vivo contra Las Condes/casa/venta (2026-07-27): el propio portal ofrece
// bandas NATIVAS en UF (`_PriceRange_0CLF-15000CLF`, `_PriceRange_15000CLF-24000CLF`,
// `_PriceRange_24000CLF-0CLF` — "CLF" es el código ISO 4217 de la UF) y su suma da
// EXACTO el total sin filtro (941+1316+1225=3482), sin bisección adicional. Bisecar
// en CLP en cambio arrastra el redondeo de una tasa UF→CLP que el portal no usa
// para filtrar — los bordes de banda en CLP no calzan con los bordes reales en UF
// que el portal aplica internamente. ARRIENDO se deja en CLP (el arriendo mensual
// en Chile se publica predominantemente en pesos, no en UF).
const PRICE_CEILING_CLF = 220_000 // UF; verificado: 0-220.000 UF da 3482 en Las Condes = su total exacto
const MIN_BAND_WIDTH_CLF = 200    // UF; no bisecar por debajo de 200 UF de ancho

// Fracción mínima del total declarado por el portal que una banda debe haber
// visto para darse por COMPLETA (ver la confirmación de fin en sweepBand). Se
// deja holgura porque el propio `total` fluctúa unas unidades entre peticiones
// (publicaciones que entran/salen en vivo): medido en real, un barrido sano da
// 691/692 = 99,9%. Un barrido truncado de los que causaban el problema daba
// 40-70%, muy por debajo de este umbral.
const MIN_BAND_COVERAGE = 0.9
// Tolerancia ABSOLUTA, para que el umbral relativo no castigue a las bandas
// diminutas: en una banda de 5 anuncios (existen: 110.000-220.000 UF en Las
// Condes tiene exactamente 5), que se venda uno entre el probe y el barrido ya
// daría 80% y la marcaría incompleta sin motivo. Una banda solo se considera
// truncada si le faltan MÁS de estos anuncios Y además baja del umbral.
const MAX_BAND_SHORTFALL = 3
// Umbral del barrido COMPLETO (unión de todas las bandas) contra el total de la
// comuna. Es la puerta que habilita dar de baja, así que es más estricto que el
// de banda: lo no visto se daría por dado de baja, y a 0,98 el error máximo
// queda acotado (~70 de 3.482 en Las Condes). Medido en real: 99,5% en un
// barrido local y 99,6% en producción, así que hay holgura de sobra.
const MIN_SWEEP_COVERAGE = 0.98

/**
 * ¿Lo visto cuadra con lo que el portal declaró? Regla ÚNICA para banda y para
 * barrido completo: vale si alcanza la fracción mínima O si lo que falta cabe en
 * la tolerancia absoluta (para bandas/comunas diminutas, donde perder 1 anuncio
 * ya hunde el porcentaje). `declared` desconocido o 0 → no se puede juzgar, se
 * da por bueno (los guardas de `seen.size > 0` cubren ese caso).
 */
function coverageOk(seenCount, declared, minFraction) {
  if (declared == null || declared <= 0) return true
  return (declared - seenCount) <= MAX_BAND_SHORTFALL || seenCount / declared >= minFraction
}

function priceUnitFor(operation) {
  return operation === 'sale' ? 'CLF' : 'CLP'
}
function priceCeilingFor(unit) {
  return unit === 'CLF' ? PRICE_CEILING_CLF : PRICE_CEILING_CLP
}
function minBandWidthFor(unit) {
  return unit === 'CLF' ? MIN_BAND_WIDTH_CLF : MIN_BAND_WIDTH_CLP
}

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
 * Token de filtro de banda de precio de Portalinmobiliario. `unit` es 'CLP' o
 * 'CLF' (UF — usada para venta, ver PRICE_CEILING_CLF más arriba). `0` = sin
 * límite (así lo escribe el propio portal: `_PriceRange_1000000000CLP-0CLP` =
 * "más de mil millones"), lo que permite una banda abierta [techo, ∞).
 *
 * Devuelve el token SIN barra: va concatenado con `_Desde_`/`_OrderId_` dentro
 * de UN MISMO segmento de ruta (ver buildListUrl — ponerlo en segmento aparte
 * hace que el portal lo ignore al paginar).
 */
export function priceRangeFilter(priceRange) {
  if (!priceRange) return ''
  const { min = 0, max = 0, unit = 'CLP' } = priceRange
  return `_PriceRange_${Math.round(min)}${unit}-${Math.round(max)}${unit}`
}

/**
 * URL de una página de listado de propiedades USADAS. `offset` en {0,48,96,…}.
 *
 * FORMATO CRÍTICO — todos los modificadores (`_Desde_`, `_OrderId_`,
 * `_PriceRange_`) van CONCATENADOS EN UN ÚNICO SEGMENTO de ruta, en ese orden,
 * cerrando con `_NoIndex_True`. Es el formato que el PROPIO portal genera en sus
 * enlaces de paginación (`pagination.pagination_nodes_url` del blob Nordic):
 *
 *   …/las-condes-metropolitana/_Desde_49_OrderId_BEGINS*DESC_PriceRange_0CLF-15000CLF_NoIndex_True
 *
 * Poner `_PriceRange_` en un segmento APARTE (…/_PriceRange_X/_Desde_49_…) hace
 * que el portal lo IGNORE en todas las páginas salvo la primera: verificado en
 * real sobre la banda 0-15.000 UF de Las Condes — con el formato de 2 segmentos,
 * la p10 devolvía anuncios de hasta 120.000 UF (41 de 48 fuera de banda) y en la
 * p21 el `total` volvía a 3483 (el total SIN filtro). Con el formato de 1
 * segmento: 0 fuera de banda en TODAS las páginas, `total` estable en ~937, y la
 * p20 cierra con 25 anuncios (19×48+25 = 937 = el total exacto) seguida de 404.
 *
 * Era la causa raíz de que las bandas de precio convergieran al mismo conjunto
 * sin filtrar al paginar (bandas distintas acumulando ~1706 ids idénticos), de la
 * cobertura estancada y del baile de altas/bajas: cada banda daba de baja lo que
 * "no veía" mientras en realidad estaba paginando la comuna entera sin filtro.
 *
 * El orden "Más recientes" (`_OrderId_BEGINS*DESC`) SÍ es compatible con
 * `_PriceRange_` en este formato (verificado: mismo `total` 937 con y sin orden,
 * y 0 fugas hasta la última página). El "bug del orden que corrompía el total"
 * documentado antes era, en realidad, este mismo bug de segmentos.
 */
export function buildListUrl({ comunaSlug: slug, regionSlug: rslug, operation, propertyType, offset = 0, priceRange = null, sortRecent = true }) {
  const type = fold(String(propertyType ?? 'casa')) || 'casa'
  const base = `https://www.portalinmobiliario.com/${operationSlug(operation)}/${type}/propiedades-usadas/${slug}-${rslug}`
  const parts = []
  if (offset > 0) parts.push(`_Desde_${offset + 1}`)
  if (sortRecent) parts.push('_OrderId_BEGINS*DESC')
  if (priceRange) parts.push(priceRangeFilter(priceRange))
  if (parts.length === 0) return base
  return `${base}/${parts.join('')}_NoIndex_True`
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
export function decideContinue({ page, pageItems, newInPage, zeroNewStreak = 0, pageCount, maxPages }) {
  // Fin REAL: el portal dejó de devolver resultados.
  if (pageItems === 0) return { stop: true, completed: true, reason: null }

  // Tope de seguridad (evita un bucle infinito si el portal nunca vacía).
  if (page >= maxPages) {
    const capBelowTotal = pageCount != null && page < pageCount
    return {
      stop: true,
      completed: !capBelowTotal,
      reason: capBelowTotal ? `tope maxPages=${maxPages} < pageCount=${pageCount}` : null,
    }
  }

  // Agotado: dos páginas SEGUIDAS sin ningún anuncio nuevo. Se exige racha de 2
  // porque el portal reordena resultados entre peticiones y una página puede
  // venir toda repetida sin que sea el final (visto en real: una página con 48
  // items pero solo 31 nuevos).
  if (newInPage === 0 && zeroNewStreak >= 2) return { stop: true, completed: true, reason: null }

  // NO se corta por `pageCount`: el portal lo reporta INESTABLE dentro de un
  // mismo barrido (visto 22 → 21 → 42 en la misma banda). Confiar en él cortaba
  // el barrido antes de tiempo y perdía anuncios en silencio — era la causa de
  // quedarse en ~70% de cobertura pese a que las bandas suman el 100%.
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

async function updateTargetStats(client, targetId, { scrapedAt, completed, listingCount, portalTotal, reason }) {
  // `notes` guarda POR QUÉ terminó así el barrido. Sin esto, un barrido que
  // devuelve 0 anuncios es indistinguible de una comuna vacía, de un bloqueo del
  // portal o de un fallo de red: el motivo se calculaba y se tiraba. Visto en
  // producción al activar 3 comunas nuevas — seis barridos seguidos a 0 sin
  // manera de saber la causa.
  await client.query(
    `UPDATE scrape_targets_cl SET
       last_run_at = $2,
       last_success_at = CASE WHEN $3 THEN $2 ELSE last_success_at END,
       last_listing_count = $4,
       portal_reported_count = COALESCE($5, portal_reported_count),
       notes = $6,
       updated_at = now()
     WHERE id = $1`,
    [targetId, scrapedAt, completed, listingCount, portalTotal, reason ?? null]
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
  // IDs vistos EN ESTA banda. Se cuenta aparte del `seen` global porque las
  // bandas solapan con el barrido base: contra el global, la primera página de
  // una banda daría "0 nuevos" y cortaría el barrido de inmediato.
  const bandSeen = new Set()
  let zeroNewStreak = 0

  for (let page = 1; page <= maxPages; page++) {
    const offset = (page - 1) * PAGE_SIZE
    const url = buildListUrl({ comunaSlug: ctx.slug, regionSlug: ctx.rslug, operation: target.operation, propertyType: target.property_type, offset, priceRange })

    const res = await fetch(url, { profile: 'portalinmobiliario' })
    if (!res.ok) {
      // 404 = el portal se quedó SIN MÁS PÁGINAS. Es la señal natural de fin al
      // paginar (verificado en real: tras la última página con resultados, la
      // siguiente devuelve 404), no un fallo. En la página 1 significa que la
      // comuna no tiene inventario para ese tipo/operación. En ambos casos el
      // barrido está COMPLETO — tratarlo como fallo dejaba todas las bandas en
      // `completed=false` y desactivaba la detección de bajas.
      const is404 = res.status === 404 || /\b404\b/.test(res.reason ?? '')
      if (is404) {
        completed = true
        reason = page === 1 ? 'sin inventario (404)' : null
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
    let newInPage = 0
    for (const l of usable) {
      seen.add(l.external_id)
      if (!bandSeen.has(l.external_id)) { bandSeen.add(l.external_id); newInPage++ }
    }
    zeroNewStreak = newInPage === 0 ? zeroNewStreak + 1 : 0

    // Normal: encolar detalle SOLO de los avisos nuevos. force_refetch (backfill):
    // encolar TODOS con su permalink fresco, para re-bajar la ficha completa.
    const ids = usable.map((l) => l.external_id)
    const known = ctx.forceRefetch ? new Set() : await existingExternalIds(client, ids)
    for (const l of usable) {
      if (!known.has(l.external_id)) { await enqueueDetail(l.external_id, l.source_url); enqueued++ }
    }

    const d = decideContinue({ page, pageItems: listings.length, newInPage, zeroNewStreak, pageCount: meta.pageCount, maxPages })
    if (d.stop) { completed = d.completed; reason = reason ?? d.reason; break }
    await sleep(politenessMs)
  }

  const capped = portalTotal != null && resultsLimit != null && portalTotal > resultsLimit

  // CONFIRMACIÓN DE FIN: que la paginación se detenga "con buena pinta" (404,
  // página vacía) no prueba que se haya visto TODO. La prueba dura es contrastar
  // lo visto contra lo que el portal declaró para esta misma banda. Sin este
  // contraste, un barrido truncado se reportaba `completed` y markDelisted daba
  // de baja anuncios vivos que simplemente no se llegaron a ver — el origen del
  // baile de altas/bajas (2061 bajas + 1574 reactivaciones en 24h).
  //
  // Solo aplica a bandas NO topadas: el barrido base de una comuna grande se
  // corta a propósito en el tope del portal (2000 de 3482) y su desvío ya lo
  // gestiona la bisección por precio.
  let coverage = null
  if (!capped && portalTotal != null && portalTotal > 0) {
    coverage = bandSeen.size / portalTotal
    if (completed && !coverageOk(bandSeen.size, portalTotal, MIN_BAND_COVERAGE)) {
      completed = false
      reason = reason ?? `cobertura insuficiente: ${bandSeen.size}/${portalTotal} vistos`
    }
  }
  return { pages, enqueued, portalTotal, resultsLimit, completed, capped, coverage, reason }
}

/**
 * Barre una banda y, si el barrido REAL la encuentra topada pese a que el probe
 * previo la había dado por chica, la subdivide más y vuelve a barrer — en vez de
 * aceptar el tope y perder el resto en silencio.
 *
 * Esto corrige dos huecos reales del diseño de un solo probe-y-barre:
 *   (a) el probe de esa sub-banda falló (red/proxy) y `subdividePriceBands` la
 *       trató como si ya cupiera bajo el tope (ver ahí: `total == null` → hoja);
 *   (b) el total de la banda creció entre el probe y el barrido real (nuevas
 *       publicaciones), típico en un barrido largo con cientos de requests.
 * Verificado contra producción: Las Condes/Venta quedó en 69% (2416/3487) con el
 * probe-único, pese a que la bisección da cobertura exacta en pruebas aisladas
 * (con probes que nunca fallan y totales que no cambian a mitad de barrido).
 */
async function sweepBandCorrective(client, ctx, range, seen, depth = 0) {
  const r = await sweepBand(client, ctx, range, seen)
  if (!r.capped) return { pages: r.pages, enqueued: r.enqueued, completed: r.completed, capped: false }

  const unit = range?.unit ?? 'CLP'
  const min = range?.min ?? 0
  const max = range?.max ?? priceCeilingFor(unit)
  // Banda ABIERTA [min, ∞) (`max === 0`, como la escribe el portal): no tiene
  // ancho finito que partir por la mitad, así que se corta en 2×min — el tramo
  // bajo queda cerrado y el alto sigue abierto. Duplicar en vez de promediar
  // hace que el techo persiga hacia arriba los precios raros que motivaron el
  // desborde, en vez de quedarse atascado cerca de `min`.
  const isOpen = max === 0
  const width = isOpen ? Infinity : max - min
  if (depth >= MAX_PRICE_DEPTH || width <= minBandWidthFor(unit)) {
    // No se puede seguir partiendo: mejor esfuerzo, esta porción queda incompleta.
    return { pages: r.pages, enqueued: r.enqueued, completed: false, capped: true }
  }

  const mid = isOpen ? Math.max(min * 2, min + minBandWidthFor(unit)) : min + Math.floor(width / 2)
  await ctx.sleep(ctx.politenessMs)
  const lower = await sweepBandCorrective(client, ctx, { min, max: mid, unit }, seen, depth + 1)
  const upper = await sweepBandCorrective(client, ctx, { min: mid, max, unit }, seen, depth + 1)
  return {
    pages: r.pages + lower.pages + upper.pages,
    enqueued: r.enqueued + lower.enqueued + upper.enqueued,
    completed: lower.completed && upper.completed,
    capped: lower.capped || upper.capped,
  }
}

/**
 * Bisección recursiva por precio: parte una banda [min,max] (en `unit`, 'CLP' o
 * 'CLF'/UF) hasta que cada sub-banda esté bajo el tope de paginación del portal.
 * `probe(range)` devuelve el `total` que el portal declara para esa banda. Puro
 * respecto a la red (recibe `probe` inyectable). Devuelve las bandas hoja a barrer.
 *
 * Colina (5699, banda alta 2118 > 2000) es justo el caso: la banda que aún topa
 * se subdivide sola, sin listas de barrios ni tope por comuna.
 */
export async function subdividePriceBands(probe, resultsLimit, min = 0, max = PRICE_CEILING_CLP, unit = 'CLP', depth = 0) {
  const total = await probe({ min, max, unit })
  // Sin dato o ya bajo el tope: es una banda hoja.
  if (total == null || total <= resultsLimit) return [{ min, max, unit }]
  // No se puede seguir partiendo (profundidad/ancho mínimo): se barre igual
  // (topará, pero es el mejor esfuerzo — caso extremo improbable).
  if (depth >= MAX_PRICE_DEPTH || (max - min) <= minBandWidthFor(unit)) return [{ min, max, unit }]
  const mid = min + Math.floor((max - min) / 2)
  const lower = await subdividePriceBands(probe, resultsLimit, min, mid, unit, depth + 1)
  const upper = await subdividePriceBands(probe, resultsLimit, mid, max, unit, depth + 1)
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
    forceRefetch = !!target.force_refetch,
    now = () => new Date(),
  } = deps

  const slug = comunaSlug(target.comuna_name)
  const rslug = regionSlug(target.region)
  const scrapedAt = now()
  const ctx = { fetch, parseList, parseMeta, enqueueDetail, maxPages, politenessMs, sleep, includeDevelopments, forceRefetch, target, slug, rslug }

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
    // Venta bisecta en UF (moneda nativa del filtro de venta del portal, ver
    // PRICE_CEILING_CLF); arriendo se mantiene en CLP.
    const unit = priceUnitFor(target.operation)
    const probe = async (range) => {
      const url = buildListUrl({ comunaSlug: slug, regionSlug: rslug, operation: target.operation, propertyType: target.property_type, priceRange: range })
      const res = await fetch(url, { profile: 'portalinmobiliario' })
      if (!res.ok) return null
      await sleep(politenessMs)
      return parseMeta(res.html).total
    }
    const ceiling = priceCeilingFor(unit)
    // Banda ABIERTA final [techo, ∞): `max: 0` es como el propio portal escribe
    // "sin límite superior". Sin ella, todo lo que supere el techo se perdería en
    // silencio. En Las Condes hoy está vacía (404, que sweepBand trata como
    // "sin inventario" → completed), pero es el seguro para comunas/tipos con
    // precios por encima del techo — cuesta una petición y evita un hueco mudo.
    const bands = [
      ...(await subdividePriceBands(probe, resultsLimit ?? 2000, 0, ceiling, unit)),
      { min: ceiling, max: 0, unit },
    ]
    bandsUsed = bands.length
    completed = true
    for (const band of bands) {
      const r = await sweepBandCorrective(client, ctx, band, seen)
      pages += r.pages; enqueued += r.enqueued
      if (!r.completed || r.capped) { allBandsExhaustive = false; completed = false }
      await sleep(politenessMs)
    }
    reason = `comuna topó paginación (total=${portalTotal}): subdividida en ${bandsUsed} bandas de precio`
  }

  // ¿Vimos la comuna entera? La medida DIRECTA es la unión de todas las bandas
  // contra el total que el portal declara — no que las ~95 peticiones de un
  // barrido salieran todas perfectas. Exigir lo segundo dejaba `last_success_at`
  // congelado y la detección de bajas apagada por un solo fallo transitorio de
  // red, aun teniendo el 99,6% de la comuna en la mano (visto en producción:
  // 3468/3481 y el target seguía marcándose incompleto).
  const sweepCoverage = portalTotal != null && portalTotal > 0 ? seen.size / portalTotal : null
  const coverageConfirmed = coverageOk(seen.size, portalTotal, MIN_SWEEP_COVERAGE)

  let exhaustive
  if (sweepCoverage != null) {
    // Hay total declarado: manda la cobertura medida, en los dos sentidos.
    exhaustive = coverageConfirmed
    completed = coverageConfirmed
    if (!coverageConfirmed) {
      reason = `cobertura del barrido ${seen.size}/${portalTotal} bajo el mínimo — no se dan de baja anuncios`
    }
  } else {
    // Sin total con el que contrastar (404 de comuna vacía, fallo en la p1):
    // se cae a las señales de terminación de la paginación.
    exhaustive = completed && !base.capped && allBandsExhaustive
  }

  let delisted = 0
  if (exhaustive && target.comuna_id && seen.size > 0) {
    delisted = await markDelisted(client, target, seen, scrapedAt)
  }

  await updateTargetStats(client, target.id, { scrapedAt, completed, listingCount: seen.size, portalTotal, reason })

  // Backfill: tras un barrido forzado que completó, apagar force_refetch para
  // no re-bajar todo en cada ciclo (solo era una pasada de puesta al día).
  if (forceRefetch && completed) {
    await client.query(`UPDATE scrape_targets_cl SET force_refetch = false, updated_at = now() WHERE id = $1`, [target.id])
  }

  return { target_id: target.id, pages, seen: seen.size, enqueued, delisted, portal_total: portalTotal, results_limit: resultsLimit, bands: bandsUsed, force_refetch: forceRefetch, completed, exhaustive, capped: base.capped, reason }
}

/**
 * Selecciona los targets `enabled` cuya cadencia venció (last_run_at más viejo
 * que interval_hours) — el scheduler del worker encola un discovery por cada uno.
 * Devuelve el payload listo para el job (con comuna_name/region ya resueltos).
 */
export async function selectDueTargets(client, { limit = 50 } = {}) {
  const { rows } = await client.query(
    `SELECT t.id, t.comuna_id, c.name AS comuna_name, c.region,
            t.operation, t.property_type, t.force_refetch
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
