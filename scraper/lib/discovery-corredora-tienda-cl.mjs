// ─────────────────────────────────────────────────────────────────────────────
// discovery-corredora-tienda-cl.mjs — barrido del inventario COMPLETO de una
// corredora por su tienda oficial (plan Anuncios CL · H23).
//
// POR QUÉ EXISTE: el barrido general (discovery-portalinmobiliario-cl.mjs) es
// por COMUNA — solo ve lo que scrape_targets_cl tiene activado (hoy, solo Las
// Condes). Una corredora grande publica en TODA la RM: verificado en vivo,
// Property Partners declara 1.966 casas en su tienda oficial mientras
// corredoras_cl solo conocía ~1.000 (lo que cae dentro de Las Condes). Activar
// comuna por comuna escala mal — cada corredora YA declara su inventario
// completo en una URL propia dentro del portal:
//
//   https://www.portalinmobiliario.com/tienda/<slug>/listado/inmuebles/
//     <tipo>s/propiedades-usadas/rm-metropolitana
//
// Verificado con HTML real (CyM Propiedades: 506 resultados, paginación
// `_Desde_N` de 48 en 48 avanza con solape mínimo entre páginas; Remax
// Diamante: misma estructura) — MISMO blob `__NORDIC_RENDERING_CTX__` que ya
// entienden `parseListPage`/`parseListMeta`. Cero parser nuevo, solo un builder
// de URL distinto y el barrido scopeado por corredora en vez de por comuna.
//
// `advertiser_store_slug` (por anuncio, 0084) y `corredoras_cl.portal_store_slug`
// (por corredora) se descubren solos durante el scraping normal de fichas —a
// diferencia de `web_propia_url`, que hay que registrar a mano— porque el
// enlace "Ir a la tienda oficial de <nombre>" es parte del HTML estándar de
// CUALQUIER ficha de esa corredora (parse-portalinmobiliario.mjs).
//
// SIN TOPE ARTIFICIAL DE PÁGINAS: a diferencia del barrido por comuna (que
// tiene un `maxPages` bajo porque una comuna cabe en pocas bandas), aquí el
// único freno es el fin real de la paginación (`decideContinue`, reutilizado
// tal cual) — página vacía o dos páginas seguidas sin nada nuevo. `maxPages`
// sigue existiendo como VÁLVULA DE SEGURIDAD contra un bucle infinito si el
// portal nunca vaciara (nunca debería activarse en un caso real), no como un
// límite de negocio — mismo criterio que ya usa discoverTarget.
// ─────────────────────────────────────────────────────────────────────────────
import { fetchHtmlResilient, SLEEP } from './fetch.mjs'
import { parseListPage, parseListMeta } from './parse-portalinmobiliario.mjs'
import { fold } from './chile-comunas.mjs'
import { decideContinue, priceRangeFilter, subdividePriceBands, coverageOk } from './discovery-portalinmobiliario-cl.mjs'

const PAGE_SIZE = 48 // mismo tamaño de página confirmado en el barrido general

// Única región soportada hoy (fase 1 del plan: RM). Verificado real contra
// `/tienda/cym-propiedades/listado/inmuebles/casas/propiedades-usadas/
// rm-metropolitana` — nótese que NO es el mismo slug que usa el barrido por
// comuna (`metropolitana`, sin "rm-"): son dos convenciones de URL distintas
// del propio portal para dos vistas distintas (comuna vs. tienda).
const TIENDA_REGION_SLUG = 'rm-metropolitana'

// Techo de paginación por precio: venta se bisecta en UF, arriendo en CLP —
// mismos valores que el barrido general (ver discovery-portalinmobiliario-cl.mjs
// para la justificación de estas cifras concretas).
const PRICE_CEILING_CLP = 10_000_000_000
const PRICE_CEILING_CLF = 220_000
const MIN_BAND_WIDTH_CLP = 10_000_000
const MIN_BAND_WIDTH_CLF = 200
const MAX_PRICE_DEPTH = 8

// Válvula de seguridad, NO límite de negocio: a 48/página, 500 páginas son
// 24.000 anuncios — ninguna corredora real se acerca a esa cifra hoy (la más
// grande vista, Property Partners, declara 1.966). Sirve solo para que un bug
// de "nunca vacía" no deje el proceso pedaleando para siempre.
const DEFAULT_MAX_PAGES = 500

// Umbral de cobertura para autorizar bajas (mismo valor y mismo motivo que
// MIN_SWEEP_COVERAGE del barrido general): las señales de fin de paginación
// (página vacía, racha sin nuevos) NO bastan por sí solas para asumir que se
// vio TODO — en producción, confiar solo en ellas dejó comunas en 69% de
// cobertura mientras se daban de baja anuncios vivos que simplemente no se
// llegaron a ver. Aquí el riesgo es el mismo o mayor (una tienda grande hace
// muchas más peticiones que una comuna), así que antes de dar de baja algo se
// contrasta `seen.size` contra el total que el propio portal declaró.
const MIN_SWEEP_COVERAGE = 0.98

function priceUnitFor(operation) {
  return operation === 'rent' ? 'CLP' : 'CLF'
}
function priceCeilingFor(unit) {
  return unit === 'CLF' ? PRICE_CEILING_CLF : PRICE_CEILING_CLP
}
function minBandWidthFor(unit) {
  return unit === 'CLF' ? MIN_BAND_WIDTH_CLF : MIN_BAND_WIDTH_CLP
}

/** "casa" → "casas", "departamento" → "departamentos" (plural que usa la URL de tienda). */
function pluralizeType(propertyType) {
  const t = fold(String(propertyType ?? 'casa')) || 'casa'
  return t.endsWith('s') ? t : `${t}s`
}

/**
 * URL de una página del inventario de una tienda oficial. Sin filtro de
 * operación en el path (a diferencia del barrido por comuna): la tienda
 * devuelve venta+arriendo mezclados, y cada item trae su propia operación en
 * `domain_id` (parseListPage ya la extrae por anuncio, sin depender de la URL)
 * — verificado real: el total declarado (1.966) es exactamente venta+arriendo.
 *
 * @param {{ storeSlug:string, propertyType?:string, offset?:number, priceRange?:{min:number,max:number,unit:string}|null, sortRecent?:boolean }} args
 */
export function buildTiendaListUrl({ storeSlug, propertyType, offset = 0, priceRange = null, sortRecent = true }) {
  const type = pluralizeType(propertyType)
  const base = `https://www.portalinmobiliario.com/tienda/${storeSlug}/listado/inmuebles/${type}/propiedades-usadas/${TIENDA_REGION_SLUG}`
  const parts = []
  if (offset > 0) parts.push(`_Desde_${offset + 1}`)
  if (sortRecent) parts.push('_OrderId_BEGINS*DESC')
  if (priceRange) parts.push(priceRangeFilter(priceRange))
  if (parts.length === 0) return base
  return `${base}/${parts.join('')}_NoIndex_True`
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
 * Barre UNA banda (opcionalmente acotada por precio) de la tienda hasta que
 * `decideContinue` dice parar. Misma forma que `sweepBand` del barrido general,
 * adaptada a `buildTiendaListUrl` (sin comuna, sin operación en el path).
 */
async function sweepTiendaBand(client, ctx, priceRange, seen) {
  const { fetch, parseList, parseMeta, enqueueDetail, maxPages, politenessMs, sleep, storeSlug, propertyType, forceRefetch } = ctx
  let pages = 0, enqueued = 0, portalTotal = null, resultsLimit = null, completed = false, reason = null
  const bandSeen = new Set()
  let zeroNewStreak = 0

  for (let page = 1; page <= maxPages; page++) {
    const offset = (page - 1) * PAGE_SIZE
    const url = buildTiendaListUrl({ storeSlug, propertyType, offset, priceRange })

    const res = await fetch(url, { profile: 'portalinmobiliario' })
    if (!res.ok) {
      // 404 = fin natural de la paginación (mismo criterio que el barrido
      // general): en la página 1 significa tienda sin inventario para este
      // tipo/banda; en cualquier otra, que ya no hay más páginas.
      const is404 = res.status === 404 || /\b404\b/.test(res.reason ?? '')
      if (is404) { completed = true; reason = page === 1 ? 'sin inventario (404)' : null }
      else reason = `fetch p${page}: ${res.reason ?? 'fallo'}`
      break
    }
    pages++

    const meta = parseMeta(res.html)
    const listings = parseList(res.html)
    if (page === 1) { portalTotal = meta.total; resultsLimit = meta.resultsLimit }

    let newInPage = 0
    for (const l of listings) {
      seen.add(l.external_id)
      if (!bandSeen.has(l.external_id)) { bandSeen.add(l.external_id); newInPage++ }
    }
    zeroNewStreak = newInPage === 0 ? zeroNewStreak + 1 : 0

    const ids = listings.map((l) => l.external_id)
    const known = forceRefetch ? new Set() : await existingExternalIds(client, ids)
    for (const l of listings) {
      if (!known.has(l.external_id)) { await enqueueDetail(l.external_id, l.source_url); enqueued++ }
    }

    const d = decideContinue({ page, pageItems: listings.length, newInPage, zeroNewStreak, pageCount: meta.pageCount, maxPages })
    if (d.stop) { completed = d.completed; reason = reason ?? d.reason; break }
    await sleep(politenessMs)
  }

  const capped = portalTotal != null && resultsLimit != null && portalTotal > resultsLimit
  return { pages, enqueued, portalTotal, resultsLimit, completed, capped, reason }
}

/**
 * Da de baja los anuncios de ESTA corredora que ya no reaparecieron en un
 * barrido COMPLETO de su tienda. Scopeado por `corredora_id` (no por comuna,
 * como el barrido general — aquí no hay una sola comuna) y por `property_type`
 * (para no dar de baja departamentos/terrenos que este barrido, acotado a
 * `casa` en esta fase, ni siquiera miró).
 */
async function markDelistedForCorredora(client, corredoraId, propertyType, seenExternalIds, scrapedAt) {
  const { rows } = await client.query(
    `SELECT id FROM listings_cl
     WHERE portal = 'portalinmobiliario' AND is_active = true
       AND corredora_id = $1 AND property_type = $2
       AND NOT (external_id = ANY($3::text[]))`,
    [corredoraId, propertyType, [...seenExternalIds]]
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

/**
 * Barre el inventario COMPLETO (RM, sin comuna) de una corredora por su tienda
 * oficial. Sin filtro de operación (ver `buildTiendaListUrl`): un único barrido
 * cubre venta + arriendo.
 *
 * @param {import('pg').Client} client
 * @param {{ id:string, portal_store_slug:string, property_type?:string, force_refetch?:boolean }} corredora
 * @param {object} [deps] inyectables para test
 */
export async function sweepCorredoraTienda(client, corredora, deps = {}) {
  const {
    fetch = fetchHtmlResilient,
    parseList = parseListPage,
    parseMeta = parseListMeta,
    enqueueDetail = async () => {},
    maxPages = DEFAULT_MAX_PAGES,
    politenessMs = 1500,
    sleep = SLEEP,
    forceRefetch = !!corredora.force_refetch,
    now = () => new Date(),
  } = deps

  const storeSlug = corredora.portal_store_slug
  const propertyType = corredora.property_type ?? 'casa'
  const scrapedAt = now()
  const ctx = { fetch, parseList, parseMeta, enqueueDetail, maxPages, politenessMs, sleep, storeSlug, propertyType, forceRefetch }

  const seen = new Set()
  const base = await sweepTiendaBand(client, ctx, null, seen)
  let { pages, enqueued, portalTotal, resultsLimit, completed, reason } = base
  let bandsUsed = 1

  if (base.capped) {
    // Tienda por encima del tope de paginación de una sola vista: subdivide por
    // precio, igual que una comuna grande en el barrido general. Sin operación
    // separada (ver arriba), así que se bisecta en CLP: es lo único que sirve
    // para ambas monedas mezcladas sin adivinar cuál predomina.
    const unit = 'CLP'
    const probe = async (range) => {
      const url = buildTiendaListUrl({ storeSlug, propertyType, priceRange: range })
      const res = await fetch(url, { profile: 'portalinmobiliario' })
      if (!res.ok) return null
      await sleep(politenessMs)
      return parseMeta(res.html).total
    }
    const ceiling = priceCeilingFor(unit)
    const bands = [
      ...(await subdividePriceBands(probe, resultsLimit ?? 2000, 0, ceiling, unit)),
      { min: ceiling, max: 0, unit },
    ]
    bandsUsed = bands.length
    completed = true
    for (const band of bands) {
      const r = await sweepTiendaBand(client, ctx, band, seen)
      pages += r.pages; enqueued += r.enqueued
      if (!r.completed || r.capped) completed = false
      await sleep(politenessMs)
    }
    reason = `tienda topó paginación (total=${portalTotal}): subdividida en ${bandsUsed} bandas de precio`
  }

  // CONFIRMACIÓN DE FIN (mismo criterio que discoverTarget, ver constante
  // arriba): que la paginación se haya detenido "con buena pinta" no prueba que
  // se vio TODO. Se contrasta lo visto contra lo que el portal declaró para
  // esta tienda; solo si cuadra se autorizan bajas.
  const sweepCoverage = portalTotal != null && portalTotal > 0 ? seen.size / portalTotal : null
  if (sweepCoverage != null) {
    const coverageConfirmed = coverageOk(seen.size, portalTotal, MIN_SWEEP_COVERAGE)
    completed = coverageConfirmed
    if (!coverageConfirmed) {
      reason = `cobertura del barrido ${seen.size}/${portalTotal} bajo el mínimo — no se dan de baja anuncios`
    }
  }

  let delisted = 0
  if (completed && seen.size > 0) {
    delisted = await markDelistedForCorredora(client, corredora.id, propertyType, seen, scrapedAt)
  }

  await client.query(
    `UPDATE corredoras_cl SET store_swept_at = $2, updated_at = now() WHERE id = $1`,
    [corredora.id, scrapedAt]
  )

  return {
    corredora_id: corredora.id, store_slug: storeSlug, pages, seen: seen.size, enqueued, delisted,
    portal_total: portalTotal, results_limit: resultsLimit, bands: bandsUsed, completed, reason,
  }
}

/**
 * Corredoras con tienda oficial conocida, priorizadas por stock (las grandes
 * son las que más se benefician de saltarse la limitación de comuna) y por
 * antigüedad del último barrido — mismo patrón que `selectDueTargets`.
 */
export async function selectDueCorredoraSweeps(client, { limit = 20, maxAgeHours = 24 } = {}) {
  const { rows } = await client.query(
    `SELECT id, portal_store_slug
       FROM corredoras_cl
      WHERE portal_store_slug IS NOT NULL
        AND (store_swept_at IS NULL
             OR store_swept_at < now() - make_interval(hours => $2))
      ORDER BY store_swept_at ASC NULLS FIRST, active_listings_count DESC
      LIMIT $1`,
    [limit, maxAgeHours]
  )
  return rows
}
