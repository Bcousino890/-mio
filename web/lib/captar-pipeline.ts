// Orquestador del pipeline de captación Chile (URL → Rol → Dueño → Teléfonos).
//
// Cada etapa es idempotente, persiste su resultado en captaciones_cl y puede
// reintentar sin duplicar trabajo:
//   1. extractListing        — parsea el anuncio y registra la captación
//   2. matchRol              — resuelve rol SII + dirección exacta (prob. ≥92%
//                              para auto-confirmar; el resto queda en revisión)
//   3. lookupOwnerTgr        — nombre del dueño vía certificado TGR (con cache)
//   4. lookupContactsDealernet — RUT + teléfonos vía DealerNet
//
// La regla dura del match está en decideMatch(): nunca se auto-confirma un rol
// con evidencia mediocre; y aunque se auto-confirme, la dirección del
// certificado TGR se cruza después contra la dirección SII — si no calzan, la
// captación vuelve a revisión (ver crossCheckTgrAddress).
import { pool } from '@/lib/db'
import { ProxyAgent, type Dispatcher } from 'undici'
import { parsePortalListingDetail } from '@/lib/parse-portalinmobiliario-cl'
import { fetchPortalInmobiliarioGallery } from '@/lib/fetch-portalinmobiliario-gallery'
import { normalizeClRol } from '@/lib/rol-format'
import {
  scoreCandidatesV3,
  type MatchResultV3,
  type ParsedListing,
  type SiiCandidateRow,
} from '@/lib/sii-match-cl-v2'
// OJO: lib/tgr.ts se importa DINÁMICAMENTE dentro de lookupOwnerTgr — su
// import estático arrastra pdf-parse/pdfjs-dist y playwright-core a TODO el
// bundle del pipeline (y pdfjs revienta el runtime de webpack en dev). Solo
// se carga cuando de verdad hay que consultar TGR en vivo (cache miss).
import {
  queryDealernet,
  queryDealernetBuscadorMultiple,
  dealernetRetcodeMessage,
  computeRutDv,
  DEFAULT_DEALERNET_PRODUCTS,
  type DealernetCandidato,
} from '@/lib/dealernet'
// Caché compartida con las API routes de DealerNet (/api/chile/dealernet-buscar
// y /api/chile/dealernet-lookup) — sin esto, este pipeline volvía a golpear el
// web service aunque el mismo rol/RUT ya se hubiera consultado desde la ficha
// o desde /chile/dealer, duplicando el gasto.
import { getCachedBuscadorMultiple, saveBuscadorMultipleCache, getCachedContactByRut, logDealernetQuery } from '@/lib/dealernet-cache'

// ─── Umbrales del match (regla pedida por el usuario: 90-95%+, ideal 100%) ───
export const AUTO_CONFIRM_PROBABILITY = 0.92 // prob. mínima para auto-confirmar
export const AUTO_CONFIRM_MARGIN = 0.15      // ventaja mínima sobre el 2º (en probabilidad)
// Con muchas señales positivas la sigmoide se satura (dos candidatos pueden
// quedar 0.99 vs 0.94 aunque uno tenga 10 puntos más de log-odds = miles de
// veces más probable). Por eso la ventaja también puede cumplirse en log-odds.
export const AUTO_CONFIRM_LOG_ODDS_MARGIN = 2.2 // ≈ 9× más probable que el 2º
export const REVIEW_PROBABILITY = 0.65       // debajo de esto ni siquiera es candidato
const TGR_CACHE_DAYS = 90
const OWNER_NAME_MATCH_THRESHOLD = 0.85

/** Tope de fotos que se persisten por captación. Portal Inmobiliario admite
 *  hasta 50 imágenes por publicación; el tope anterior (40) recortaba fichas
 *  completas. */
export const MAX_PHOTOS = 60

// ─── Comunas Portal Inmobiliario → código SII ────────────────────────────────
// Fallback estático, alineado con chile_comunas (los códigos reales confirmados
// en 0024/0025/0026 — el mapa anterior de parse-listing tenía 5 de 8 códigos
// equivocados, p.ej. Vitacura 15131 en vez de 15160, y la búsqueda de roles
// devolvía siempre 0 candidatos). La fuente de verdad es la BD: ver
// resolveComunaFromDb().
export const SLUG_TO_SII: Record<string, { siiCode: string; label: string }> = {
  vitacura: { siiCode: '15160', label: 'Vitacura' },
  'las-condes': { siiCode: '15108', label: 'Las Condes' },
  'lo-barnechea': { siiCode: '15161', label: 'Lo Barnechea' },
  colina: { siiCode: '14201', label: 'Colina' },
  providencia: { siiCode: '13123', label: 'Providencia' },
  nunoa: { siiCode: '13120', label: 'Ñuñoa' },
  'la-reina': { siiCode: '13113', label: 'La Reina' },
  santiago: { siiCode: '13101', label: 'Santiago' },
}

// Cache en memoria de chile_comunas (≤346 filas) para resolver por nombre sin
// depender del mapa estático.
let comunaCacheAt = 0
let comunaCache: Array<{ slug: string; name: string; siiCode: string }> = []

export async function resolveComunaFromDb(
  name: string | null | undefined,
): Promise<{ siiCode: string; label: string; slug: string } | null> {
  if (!name) return null
  const now = Date.now()
  if (now - comunaCacheAt > 10 * 60_000 || comunaCache.length === 0) {
    try {
      const { rows } = await pool.query(
        `SELECT name, sii_comuna_code FROM chile_comunas WHERE sii_comuna_code IS NOT NULL AND sii_comuna_code <> ''`,
      )
      comunaCache = rows.map((r) => ({ slug: normalizeToSlug(r.name), name: r.name, siiCode: r.sii_comuna_code }))
      comunaCacheAt = now
    } catch {
      // sin BD se usa el mapa estático
    }
  }
  const slug = normalizeToSlug(name)
  // Preferir la coincidencia más larga ("lo-barnechea" antes que "colina"
  // dentro de un slug largo tipo "casa-la-colina-lo-barnechea")
  const hit = comunaCache
    .filter((c) => slug === c.slug || slug.includes(c.slug) || c.slug.includes(slug))
    .sort((a, b) => b.slug.length - a.slug.length)[0]
  return hit ? { siiCode: hit.siiCode, label: hit.name, slug: hit.slug } : null
}

/** Resolución con BD primero y mapa estático como fallback. */
export async function resolveComunaAsync(
  name: string | null | undefined,
): Promise<{ siiCode: string; label: string; slug: string } | null> {
  return (await resolveComunaFromDb(name)) ?? resolveComuna(name)
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function normalizeToSlug(s: string): string {
  return stripAccents(s).toLowerCase().trim().replace(/\s+/g, '-')
}

export function resolveComuna(name: string | null | undefined): { siiCode: string; label: string; slug: string } | null {
  if (!name) return null
  const slug = normalizeToSlug(name)
  for (const [key, val] of Object.entries(SLUG_TO_SII)) {
    if (slug.includes(key) || key.includes(slug)) {
      return { ...val, slug: key }
    }
  }
  return null
}

export function extractFromSlug(url: string): Record<string, string | number | null> | null {
  // ej. MLC-2009525691-arriendo-casa-6hab-5ba-vitacura-_JM
  const match = url.match(/MLC-\d+-(.+?)(?:_JM|$)/)
  if (!match) return null
  const slug = match[1].toLowerCase()

  const info: Record<string, string | number | null> = { raw_slug: slug }

  if (slug.includes('arriendo')) info.operation = 'rent'
  else if (slug.includes('venta')) info.operation = 'sale'
  else info.operation = null

  if (slug.includes('-casa')) info.property_type = 'casa'
  else if (slug.includes('-departamento') || slug.includes('-depto') || slug.includes('-dpto')) info.property_type = 'departamento'
  else if (slug.includes('-oficina')) info.property_type = 'oficina'
  else if (slug.includes('-terreno')) info.property_type = 'terreno'
  else info.property_type = null

  const habMatch = slug.match(/(\d+)hab/)
  info.bedrooms = habMatch ? parseInt(habMatch[1]) : null

  const baMatch = slug.match(/(\d+)ba/)
  info.bathrooms = baMatch ? parseInt(baMatch[1]) : null

  const comuna = resolveComuna(slug)
  info.comuna_slug = comuna?.slug ?? null
  info.sii_code = comuna?.siiCode ?? null
  info.comuna_label = comuna?.label ?? null

  return info
}

// Mismo criterio de proxy que scraper/lib/fetch.mjs (proxyUrl()) — variables
// de entorno compartidas con el scraper standalone, prioridad idéntica:
// SMARTPROXY_URL / PROXY_URL (genéricos) → Evomi CL (H10, activo) →
// SmartProxy CL (legacy).
function chileProxyUrl(): string | null {
  if (process.env.SMARTPROXY_URL) return process.env.SMARTPROXY_URL
  if (process.env.PROXY_URL) return process.env.PROXY_URL
  const { EVOMI_PROXY_HOST, EVOMI_PROXY_PORT, EVOMI_PROXY_USER, EVOMI_PROXY_PASS } = process.env
  if (EVOMI_PROXY_USER) return `http://${EVOMI_PROXY_USER}:${EVOMI_PROXY_PASS}@${EVOMI_PROXY_HOST}:${EVOMI_PROXY_PORT}`
  const { SMARTPROXY_CL_HOST, SMARTPROXY_CL_PORT, SMARTPROXY_CL_USER, SMARTPROXY_CL_PASS } = process.env
  if (SMARTPROXY_CL_USER) return `http://${SMARTPROXY_CL_USER}:${SMARTPROXY_CL_PASS}@${SMARTPROXY_CL_HOST}:${SMARTPROXY_CL_PORT}`
  return null
}

async function fetchListingPageVia(url: string, proxy: string | null): Promise<{ status: number; html: string }> {
  const init: RequestInit & { dispatcher?: Dispatcher } = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
    },
    signal: AbortSignal.timeout(10000),
  }
  if (proxy) init.dispatcher = new ProxyAgent(proxy)
  const res = await fetch(url, init)
  return { status: res.status, html: await res.text() }
}

/**
 * Fetch de una ficha de Portal Inmobiliario, DIRECTO primero (igual que
 * scraper/lib/fetch.mjs `fetchHtmlPi` — PI no tiene anti-bot agresivo tipo
 * DataDome, el directo suele bastar). Si el directo viene bloqueado (403/
 * IP de datacenter) o sirve la variante "ligera" sin el blob Nordic (el
 * parser saca 0 de ella), cae al proxy residencial (Evomi/SmartProxy CL) SOLO
 * si hay uno configurado — evita que el botón "Re-scrapear" de la ficha
 * (que corre en el mismo servidor que la web, sin el proxy del scraper 24/7)
 * falle en seco con HTTP 403.
 */
export async function fetchListingPage(url: string): Promise<string> {
  const cleanUrl = url.split('#')[0].split('?')[0]
  const hasBlob = (html: string) => html.includes('__NORDIC_RENDERING_CTX__')

  let direct: { status: number; html: string } | null = null
  let directErr: unknown = null
  try {
    direct = await fetchListingPageVia(cleanUrl, null)
    if (direct.status === 200 && hasBlob(direct.html)) return direct.html
  } catch (e) {
    directErr = e
  }

  const proxy = chileProxyUrl()
  if (proxy) {
    try {
      const proxied = await fetchListingPageVia(cleanUrl, proxy)
      if (proxied.status === 200) return proxied.html
    } catch {
      // sin proxy que responda, se degrada al resultado directo de abajo
    }
  }

  if (direct) {
    if (direct.status !== 200) throw new Error(`HTTP ${direct.status}`)
    return direct.html // 200 sin blob Nordic — variante ligera, mejor que nada
  }
  throw directErr instanceof Error ? directErr : new Error('No se pudo descargar la página')
}

// ─── Candidatos SII con scoring V3 ───────────────────────────────────────────

export interface ScoredCandidate extends SiiCandidateRow {
  match_score: number
  match_result_v3: MatchResultV3
}

/**
 * `sii_roles_cl` puede traer más de una fila física para el mismo `rol` (se
 * han visto reimportaciones/snapshots duplicados sin deduplicar en origen —
 * ej. una fila con `sii_construcciones_cl` ya vinculada y otra sin vincular
 * para el mismo rol, con distinto score resultante). Sin este filtro el mismo
 * candidato aparece dos veces en la lista con puntajes distintos, lo cual es
 * confuso e incorrecto independientemente de cuál sea "el bueno". Al estar ya
 * ordenado por match_score descendente, quedarse con la primera ocurrencia de
 * cada rol conserva la de mejor evidencia.
 */
function dedupeByRol(scored: ScoredCandidate[]): ScoredCandidate[] {
  const seen = new Set<string>()
  return scored.filter((c) => {
    if (seen.has(c.rol)) return false
    seen.add(c.rol)
    return true
  })
}

export async function findSiiCandidatesV3(
  siiCode: string,
  listing: ParsedListing,
): Promise<ScoredCandidate[]> {
  if (!siiCode) return []
  const hasGeo = listing.lat != null && listing.lng != null
  let geoScored: ScoredCandidate[] = []

  if (hasGeo) {
    // Los portales difuminan o corren el pin (a veces 1-2 km): se expande el
    // radio progresivamente y la dirección/ficha técnica deciden — una
    // dirección exacta anula la penalización por distancia (ver scoreCandidateV3).
    const radios = [100, 300, 1000, 2500]
    for (const radius of radios) {
      try {
        const res = await pool.query(
          `SELECT
             r.rol, r.direccion, r.avaluo_fiscal_total, r.superficie_terreno_m2,
             r.superficie_construida_m2, r.codigo_destino_principal, r.rol_padre, r.lat, r.lng,
             con.numero_pisos, con.anio_construccion,
             ST_DistanceSphere(r.geom, ST_SetSRID(ST_MakePoint($4, $3), 4326)) AS distance_m,
             CASE WHEN $2::text IS NOT NULL AND r.direccion IS NOT NULL
                  THEN similarity(unaccent_immutable(upper(r.direccion)), unaccent_immutable(upper($2)))
                  ELSE NULL END AS text_sim
           FROM sii_roles_cl r
           LEFT JOIN LATERAL (
             SELECT max(c.numero_pisos) AS numero_pisos,
                    round(sum(c.superficie_m2 * c.anio_construccion)::numeric
                          / NULLIF(sum(c.superficie_m2) FILTER (WHERE c.anio_construccion IS NOT NULL), 0))::int AS anio_construccion
             FROM sii_construcciones_cl c
             WHERE c.rol_id = r.id AND (c.numero_pisos IS NOT NULL OR c.anio_construccion IS NOT NULL)
           ) con ON true
           WHERE r.sii_comuna_code = $1
             AND r.lat IS NOT NULL AND r.lng IS NOT NULL
             AND ST_DistanceSphere(r.geom, ST_SetSRID(ST_MakePoint($4, $3), 4326)) < $5
           ORDER BY distance_m ASC, r.avaluo_fiscal_total DESC NULLS LAST
           LIMIT 40`,
          [siiCode, listing.address ?? null, listing.lat, listing.lng, radius],
        )
        if (res.rows.length > 0) {
          const scored = dedupeByRol(scoreCandidatesV3(listing, res.rows))
          geoScored = scored
          const best = scored[0]
          if (best.match_result_v3.confidence_level === 'confirmed') return scored.slice(0, 12)
          if (scored.filter((s) => s.match_result_v3.confidence_level === 'high_candidate').length >= 3) return scored.slice(0, 12)
          if (best.match_score > 0.75 && radius >= 300) return scored.slice(0, 12)
          // En el radio más amplio (2.5 km) ya NO se retorna a ciegas si la
          // mejor evidencia sigue siendo floja: eso pasaba cuando el rol real
          // no tiene lat/lng en catastro (columna excluida por completo del
          // WHERE de arriba) o el pin del portal está mal ubicado — en ambos
          // casos ST_DistanceSphere jamás puede encontrar al candidato
          // correcto, sin importar cuánto se agrande el radio. Se sigue de
          // largo hacia la búsqueda por dirección/superficie de abajo para
          // complementar en vez de quedarse con "lo más cercano, aunque sea malo".
        }
      } catch {
        continue
      }
    }
  }

  if (geoScored[0] && geoScored[0].match_score >= 0.5) return geoScored.slice(0, 12)

  // Fallback / complemento por dirección + superficie: corre siempre que la
  // búsqueda geográfica no haya encontrado ya algo razonablemente bueno (o
  // no haya coordenadas del todo). Sus resultados se fusionan con los de la
  // búsqueda geográfica en vez de reemplazarlos.
  try {
    let query = `
      SELECT
        r.rol, r.direccion, r.avaluo_fiscal_total, r.superficie_terreno_m2,
        r.superficie_construida_m2, r.codigo_destino_principal, r.rol_padre, r.lat, r.lng,
        con.numero_pisos, con.anio_construccion,
        NULL::double precision AS distance_m,
        CASE WHEN $2::text IS NOT NULL AND r.direccion IS NOT NULL
             THEN similarity(unaccent_immutable(upper(r.direccion)), unaccent_immutable(upper($2)))
             ELSE NULL END AS text_sim
      FROM sii_roles_cl r
      LEFT JOIN LATERAL (
        SELECT max(c.numero_pisos) AS numero_pisos,
               round(sum(c.superficie_m2 * c.anio_construccion)::numeric
                     / NULLIF(sum(c.superficie_m2) FILTER (WHERE c.anio_construccion IS NOT NULL), 0))::int AS anio_construccion
        FROM sii_construcciones_cl c
        WHERE c.rol_id = r.id AND (c.numero_pisos IS NOT NULL OR c.anio_construccion IS NOT NULL)
      ) con ON true
      WHERE r.sii_comuna_code = $1
    `
    const params: unknown[] = [siiCode, listing.address ?? null]
    if (listing.address) {
      params.push(`%${listing.address.toUpperCase()}%`)
      query += ` AND r.direccion ILIKE $${params.length}`
    }
    const landHint = listing.sqm_terreno ?? listing.sqm
    if (landHint) {
      params.push(landHint * 0.5, landHint * 1.5)
      query += ` AND r.superficie_terreno_m2 BETWEEN $${params.length - 1} AND $${params.length}`
    }
    query += ` ORDER BY text_sim DESC NULLS LAST, r.avaluo_fiscal_total DESC NULLS LAST LIMIT 40`
    const res = await pool.query(query, params)
    const addrScored = scoreCandidatesV3(listing, res.rows)
    const merged = dedupeByRol([...geoScored, ...addrScored].sort((a, b) => b.match_score - a.match_score))
    return merged.slice(0, 12)
  } catch {
    return geoScored.slice(0, 12)
  }
}

// ─── Decisión del match (la regla de los 92%) ────────────────────────────────

export interface MatchDecision {
  status: 'auto_confirmed' | 'needs_review' | 'no_match'
  best: ScoredCandidate | null
  reason: string
}

export function decideMatch(scored: ScoredCandidate[]): MatchDecision {
  if (scored.length === 0) return { status: 'no_match', best: null, reason: 'Sin candidatos SII en la zona' }
  const best = scored[0]
  const second = scored[1]
  const p1 = best.match_score
  const p2 = second?.match_score ?? 0
  const lo1 = best.match_result_v3?.log_odds ?? 0
  const lo2 = second?.match_result_v3?.log_odds ?? -99

  if (p1 < REVIEW_PROBABILITY) {
    return { status: 'no_match', best: null, reason: `Mejor candidato con probabilidad ${(p1 * 100).toFixed(0)}% (<65%)` }
  }
  const clearWinner = p1 - p2 >= AUTO_CONFIRM_MARGIN || lo1 - lo2 >= AUTO_CONFIRM_LOG_ODDS_MARGIN
  if (p1 >= AUTO_CONFIRM_PROBABILITY && clearWinner) {
    const ventaja = p1 - p2 >= AUTO_CONFIRM_MARGIN
      ? `${((p1 - p2) * 100).toFixed(0)} pts sobre el 2º`
      : `${(lo1 - lo2).toFixed(1)} log-odds (≈${Math.round(Math.exp(lo1 - lo2))}× más probable que el 2º)`
    return { status: 'auto_confirmed', best, reason: `Probabilidad ${(p1 * 100).toFixed(0)}% con ventaja de ${ventaja}` }
  }
  if (p1 >= AUTO_CONFIRM_PROBABILITY) {
    return { status: 'needs_review', best, reason: `Probabilidad ${(p1 * 100).toFixed(0)}% pero el 2º candidato está demasiado cerca` }
  }
  return { status: 'needs_review', best, reason: `Probabilidad ${(p1 * 100).toFixed(0)}% (<92%): requiere confirmación manual` }
}

// ─── Utilidades de nombres/direcciones ───────────────────────────────────────

function normalizeName(s: string | null | undefined): string {
  if (!s) return ''
  return stripAccents(s).toUpperCase().replace(/[^A-Z0-9Ñ ]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Similitud de nombres por solapamiento de tokens (orden-independiente):
 *  "PEREZ SOTO JUAN" vs "JUAN PEREZ SOTO" → 1.0 */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = new Set(normalizeName(a).split(' ').filter((w) => w.length > 1))
  const tb = new Set(normalizeName(b).split(' ').filter((w) => w.length > 1))
  if (ta.size === 0 || tb.size === 0) return 0
  const common = [...ta].filter((w) => tb.has(w)).length
  return common / Math.min(ta.size, tb.size)
}

function normalizeAddr(s: string | null | undefined): string {
  return normalizeName(s)
    .replace(/\b(AV|AVDA|AVE)\b/g, 'AVENIDA')
    .replace(/\b(PJE)\b/g, 'PASAJE')
}

function streetNumber(s: string | null | undefined): string | null {
  const m = normalizeAddr(s).match(/\b(\d{1,6})\b/)
  return m ? m[1] : null
}

/** Cruce documental: ¿la dirección del certificado TGR corresponde a la
 *  dirección SII del rol elegido? Si sí → el match queda VERIFICADO (ya no es
 *  solo probabilidad). */
export function addressesMatch(tgrDir: string | null | undefined, siiDir: string | null | undefined): boolean {
  const a = normalizeAddr(tgrDir)
  const b = normalizeAddr(siiDir)
  if (!a || !b) return false
  const numA = streetNumber(a)
  const numB = streetNumber(b)
  if (numA && numB && numA !== numB) return false
  const ta = new Set(a.split(' ').filter((w) => w.length > 2 && !/^\d+$/.test(w)))
  const tb = new Set(b.split(' ').filter((w) => w.length > 2 && !/^\d+$/.test(w)))
  if (ta.size === 0 || tb.size === 0) return Boolean(numA && numB && numA === numB)
  const common = [...ta].filter((w) => tb.has(w)).length
  return common / Math.min(ta.size, tb.size) >= 0.6 && Boolean(!numA || !numB || numA === numB)
}

// ─── Tipos de fila ───────────────────────────────────────────────────────────

export interface CaptacionRow {
  id: string
  source_url: string
  listing_cl_id: string | null
  title: string | null
  operation: string | null
  property_type: string | null
  price_raw: number | null
  currency: string | null
  sqm: number | null
  bedrooms: number | null
  bathrooms: number | null
  address: string | null
  comuna_label: string | null
  sii_comuna_code: string | null
  latitude: number | null
  longitude: number | null
  photos: unknown
  selected_photo_urls: unknown // string[] — fotos elegidas por el usuario para la verificación visual
  raw_extracted: Record<string, unknown> | null
  sii_rol: string | null
  sii_direccion: string | null
  match_score: number | null
  match_confidence: string | null
  match_verified: boolean
  match_method: string | null
  match_signals: unknown
  candidates: ScoredCandidate[] | null
  tgr_status: string
  owner_name: string | null
  tgr_direccion: string | null
  tgr_consulted_at: string | null
  tgr_error: string | null
  dealernet_status: string
  owner_rut: string | null
  owner_rut_candidates: unknown
  phones: unknown
  emails: unknown
  dealernet_consulted_at: string | null
  dealernet_error: string | null
  stage: string
  needs_review: boolean
  review_reason: string | null
  created_at: string
  updated_at: string
}

export async function getCaptacion(id: string): Promise<CaptacionRow | null> {
  const { rows } = await pool.query(`SELECT * FROM captaciones_cl WHERE id = $1`, [id])
  return (rows[0] as CaptacionRow) ?? null
}

// ─── Etapa 1: extracción ─────────────────────────────────────────────────────

export interface ExtractResult {
  captacion: CaptacionRow
  fetch_error: string | null
}

export async function extractListing(url: string): Promise<ExtractResult> {
  const cleanUrl = url.split('#')[0].split('?')[0]
  const slugInfo = extractFromSlug(cleanUrl)

  let parsed: Record<string, unknown> = {}
  let fetchError: string | null = null
  let galleryError: string | null = null
  try {
    const html = await fetchListingPage(cleanUrl)
    const detail = parsePortalListingDetail(html)
    if (detail) {
      // Si hay URL de galería, fetch todas las fotos del modal
      const allPhotos = detail.photos
      const fromHtml = allPhotos.length
      if (detail.gallery_url) {
        const galleryPhotos = await fetchPortalInmobiliarioGallery(detail.gallery_url)
        if (galleryPhotos.length === 0) galleryError = 'El modal de galería no devolvió fotos (bloqueo del portal)'
        // Combina fotos del HTML estático con las del modal (deduplicado)
        const seenPhotos = new Set(allPhotos)
        for (const photo of galleryPhotos) {
          if (!seenPhotos.has(photo)) {
            allPhotos.push(photo)
            seenPhotos.add(photo)
          }
        }
      }

      parsed = {
        title: detail.title,
        operation: detail.operation,
        property_type: detail.property_type,
        price_raw: detail.price,
        currency: detail.currency,
        sqm: detail.square_meters,
        bedrooms: detail.bedrooms,
        bathrooms: detail.bathrooms,
        lat: detail.latitude,
        lng: detail.longitude,
        address: detail.address,
        address_full: detail.address && detail.comuna ? `${detail.address}, ${detail.comuna}` : detail.address,
        advertiser_name: detail.advertiser_name,
        advertiser_type: detail.advertiser_type,
        photos: allPhotos.slice(0, MAX_PHOTOS),
        photos_total_count: detail.photos_total_count,
        // Trazabilidad de la galería: cuántas trajo el HTML estático, cuántas
        // el modal, y por qué faltan si el total del portal es mayor. Sin esto
        // la ficha se quedaba en 5 fotos sin decir que faltaban.
        photos_from_html: fromHtml,
        photos_from_gallery: Math.max(0, allPhotos.length - fromHtml),
        description: detail.description,
        comuna_detected: detail.comuna,
        // Ficha técnica V4
        sqm_terreno: detail.sqm_terreno,
        sqm_construida: detail.sqm_construida,
        floors: detail.floors,
        year_built: detail.year_built,
        orientation: detail.orientation,
        parking: detail.parking,
        storage: detail.storage,
        has_pool: detail.has_pool,
        is_condo: detail.is_condo,
      }
    } else {
      fetchError = 'No se pudo interpretar el contenido del anuncio'
    }
  } catch (e) {
    fetchError = e instanceof Error ? e.message : 'Error fetching URL'
  }

  const comunaMatch = (await resolveComunaAsync((parsed.comuna_detected as string) ?? null))
    ?? (await resolveComunaAsync((slugInfo?.raw_slug as string) ?? null))
    ?? (slugInfo?.sii_code
      ? { siiCode: slugInfo.sii_code as string, label: slugInfo.comuna_label as string, slug: slugInfo.comuna_slug as string }
      : null)

  const merged: Record<string, unknown> = {
    ...slugInfo,
    ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== null && v !== undefined)),
    sii_code: comunaMatch?.siiCode ?? null,
    comuna_slug: comunaMatch?.slug ?? null,
    comuna_label: comunaMatch?.label ?? null,
    fetch_error: fetchError,
    // Explícitos (fuera del filtro de nulos) para que un re-fetch exitoso
    // limpie el error del intento anterior en vez de arrastrarlo por el
    // merge de `raw_extracted`.
    gallery_error: galleryError,
  }

  // Registrar el anuncio también en listings_cl (capa cruda) — así la captación
  // deja huella en el inventario general y el dedup posterior lo ve.
  let listingClId: string | null = null
  const externalId = cleanUrl.match(/MLC-?\d+/)?.[0]?.replace('MLC-', 'MLC') ?? null
  if (externalId) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO listings_cl (
           portal, source_type, external_id, source_url, operation, advertiser_type,
           advertiser_name, price, bedrooms, bathrooms, square_meters, property_type,
           comuna_raw, address, latitude, longitude, description, photos
         ) VALUES ('portalinmobiliario','portal',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (portal, external_id) DO UPDATE SET
           source_url = EXCLUDED.source_url,
           price = COALESCE(EXCLUDED.price, listings_cl.price),
           address = COALESCE(EXCLUDED.address, listings_cl.address),
           latitude = COALESCE(EXCLUDED.latitude, listings_cl.latitude),
           longitude = COALESCE(EXCLUDED.longitude, listings_cl.longitude),
           last_seen_at = now(), updated_at = now()
         RETURNING id`,
        [
          externalId,
          cleanUrl,
          merged.operation ?? null,
          (merged.advertiser_type as string) ?? 'unknown',
          merged.advertiser_name ?? null,
          merged.currency === 'CLP' ? merged.price_raw ?? null : null,
          merged.bedrooms ?? null,
          merged.bathrooms ?? null,
          merged.sqm ?? null,
          merged.property_type ?? null,
          merged.comuna_label ?? null,
          merged.address ?? null,
          merged.lat ?? null,
          merged.lng ?? null,
          merged.description ?? null,
          merged.photos ? JSON.stringify(merged.photos) : null,
        ],
      )
      listingClId = rows[0]?.id ?? null
    } catch {
      // listings_cl es secundario aquí: la captación sigue aunque falle el upsert
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO captaciones_cl (
       source_url, listing_cl_id, title, operation, property_type, price_raw, currency,
       sqm, bedrooms, bathrooms, address, comuna_label, sii_comuna_code,
       latitude, longitude, photos, raw_extracted
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (source_url) DO UPDATE SET
       listing_cl_id = COALESCE(EXCLUDED.listing_cl_id, captaciones_cl.listing_cl_id),
       title = COALESCE(EXCLUDED.title, captaciones_cl.title),
       operation = COALESCE(EXCLUDED.operation, captaciones_cl.operation),
       property_type = COALESCE(EXCLUDED.property_type, captaciones_cl.property_type),
       price_raw = COALESCE(EXCLUDED.price_raw, captaciones_cl.price_raw),
       currency = COALESCE(EXCLUDED.currency, captaciones_cl.currency),
       sqm = COALESCE(EXCLUDED.sqm, captaciones_cl.sqm),
       bedrooms = COALESCE(EXCLUDED.bedrooms, captaciones_cl.bedrooms),
       bathrooms = COALESCE(EXCLUDED.bathrooms, captaciones_cl.bathrooms),
       address = COALESCE(EXCLUDED.address, captaciones_cl.address),
       comuna_label = COALESCE(EXCLUDED.comuna_label, captaciones_cl.comuna_label),
       sii_comuna_code = COALESCE(EXCLUDED.sii_comuna_code, captaciones_cl.sii_comuna_code),
       latitude = COALESCE(EXCLUDED.latitude, captaciones_cl.latitude),
       longitude = COALESCE(EXCLUDED.longitude, captaciones_cl.longitude),
       photos = CASE
         WHEN EXCLUDED.photos IS NULL THEN captaciones_cl.photos
         WHEN jsonb_array_length(EXCLUDED.photos)
              >= jsonb_array_length(COALESCE(captaciones_cl.photos, '[]'::jsonb)) THEN EXCLUDED.photos
         ELSE captaciones_cl.photos
       END,
       -- Merge, no reemplazo: si el re-fetch cae en un bloqueo del portal
       -- (403 / IP de datacenter) el payload nuevo trae poco más que el
       -- fetch_error, y un reemplazo plano borraba la ficha técnica ya
       -- extraída (terreno, año, piscina, descripción). Las claves nuevas
       -- pisan a las viejas; las que faltan se conservan.
       raw_extracted = COALESCE(captaciones_cl.raw_extracted, '{}'::jsonb) || EXCLUDED.raw_extracted,
       updated_at = now()
     RETURNING *`,
    [
      cleanUrl,
      listingClId,
      merged.title ?? null,
      merged.operation ?? null,
      merged.property_type ?? null,
      merged.price_raw ?? null,
      merged.currency ?? null,
      merged.sqm ?? null,
      merged.bedrooms ?? null,
      merged.bathrooms ?? null,
      (merged.address_full as string) ?? (merged.address as string) ?? null,
      merged.comuna_label ?? null,
      merged.sii_code ?? null,
      merged.lat ?? null,
      merged.lng ?? null,
      merged.photos ? JSON.stringify(merged.photos) : null,
      JSON.stringify(merged),
    ],
  )

  return { captacion: rows[0] as CaptacionRow, fetch_error: fetchError }
}

// ─── Etapa 2: match de rol ───────────────────────────────────────────────────

function captacionToParsedListing(c: CaptacionRow): ParsedListing {
  const raw = (c.raw_extracted ?? {}) as Record<string, unknown>
  const num = (v: unknown) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
  return {
    title: c.title ?? undefined,
    address: (raw.address as string) ?? c.address,
    address_full: (raw.address_full as string) ?? c.address,
    lat: c.latitude != null ? Number(c.latitude) : null,
    lng: c.longitude != null ? Number(c.longitude) : null,
    sqm: c.sqm,
    bedrooms: c.bedrooms,
    bathrooms: c.bathrooms,
    operation: c.operation,
    property_type: c.property_type,
    price_raw: c.price_raw != null ? Number(c.price_raw) : null,
    currency: c.currency,
    // Ficha técnica V4 (persistida en raw_extracted)
    sqm_terreno: num(raw.sqm_terreno),
    sqm_construida: num(raw.sqm_construida),
    floors: num(raw.floors),
    year_built: num(raw.year_built),
    orientation: (raw.orientation as string) ?? null,
    is_condo: raw.is_condo === true,
    has_pool: raw.has_pool === true,
  }
}

export interface MatchStageResult {
  captacion: CaptacionRow
  decision: MatchDecision
  candidates: ScoredCandidate[]
  visual_usage?: import('@/lib/visual-match-cl').VisualUsage
}

export async function matchRol(captacionId: string): Promise<MatchStageResult> {
  const c = await getCaptacion(captacionId)
  if (!c) throw new Error('Captación no encontrada')
  if (!c.sii_comuna_code) {
    const { rows } = await pool.query(
      `UPDATE captaciones_cl SET match_confidence = 'none', needs_review = true,
         review_reason = 'Comuna sin datos SII disponibles', updated_at = now()
       WHERE id = $1 RETURNING *`,
      [captacionId],
    )
    return { captacion: rows[0], decision: { status: 'no_match', best: null, reason: 'Comuna sin datos SII' }, candidates: [] }
  }

  const listing = captacionToParsedListing(c)
  const scored = await findSiiCandidatesV3(c.sii_comuna_code, listing)
  const decision = decideMatch(scored)

  const best = decision.status === 'auto_confirmed' ? decision.best : null
  const { rows } = await pool.query(
    `UPDATE captaciones_cl SET
       sii_rol = $2,
       sii_direccion = $3,
       match_score = $4,
       match_confidence = $5,
       match_method = $6,
       match_signals = $7,
       candidates = $8,
       stage = CASE WHEN $2::text IS NOT NULL THEN 'matched' ELSE stage END,
       needs_review = $9,
       review_reason = $10,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      captacionId,
      best?.rol ?? null,
      best?.direccion ?? null,
      decision.best?.match_score ?? scored[0]?.match_score ?? null,
      decision.status === 'auto_confirmed' ? 'confirmed' : decision.status === 'needs_review' ? 'candidate' : 'none',
      decision.status === 'auto_confirmed' ? 'auto' : null,
      best ? JSON.stringify(best.match_result_v3.signals) : null,
      JSON.stringify(scored),
      decision.status === 'needs_review',
      decision.status === 'auto_confirmed' ? null : decision.reason,
    ],
  )

  if (best) await syncListingIdentity(rows[0] as CaptacionRow)
  return { captacion: rows[0] as CaptacionRow, decision, candidates: scored }
}

/**
 * Verificación visual con IA (V4): compara las fotos del anuncio con el
 * satélite de cada candidato (piscina, techo/teja, entorno) y re-puntúa.
 * Puede subir un match dudoso por encima del 92% (auto-confirmación) o
 * hundir candidatos que contradicen las fotos.
 *
 * @param selectedPhotoUrls Fotos elegidas por el usuario en la UI. Solo se
 *   aceptan URLs que pertenezcan al anuncio; la selección se persiste en
 *   selected_photo_urls (aunque falle el modelo) y se reutiliza en siguientes
 *   análisis. Array vacío = limpiar selección (vuelve al fallback de 4 fotos).
 */
export async function verifyVisual(captacionId: string, selectedPhotoUrls?: string[]): Promise<MatchStageResult> {
  const c = await getCaptacion(captacionId)
  if (!c) throw new Error('Captación no encontrada')
  const prevCandidates = (c.candidates ?? []) as ScoredCandidate[]
  if (prevCandidates.length === 0) throw new Error('No hay candidatos que verificar — corre primero el match')

  const { verifyCandidatesVisually } = await import('@/lib/visual-match-cl')
  const raw = (c.raw_extracted ?? {}) as Record<string, unknown>
  const photos: string[] = Array.isArray(c.photos) ? (c.photos as string[]) : []

  // Selección de fotos: solo URLs que realmente pertenecen al anuncio (nunca
  // se envían URLs arbitrarias al modelo). Nueva selección > selección guardada.
  const photoSet = new Set(photos)
  let selection: string[]
  if (selectedPhotoUrls) {
    selection = selectedPhotoUrls.filter((u) => photoSet.has(u))
    await pool.query(
      `UPDATE captaciones_cl SET selected_photo_urls = $2, updated_at = now() WHERE id = $1`,
      [captacionId, JSON.stringify(selection)],
    )
  } else {
    const saved = Array.isArray(c.selected_photo_urls) ? (c.selected_photo_urls as string[]) : []
    selection = saved.filter((u) => photoSet.has(u))
  }

  const { verdicts, usage } = await verifyCandidatesVisually(
    photos,
    prevCandidates,
    {
      title: c.title,
      description: (raw.description as string) ?? null,
      has_pool: raw.has_pool === true,
      property_type: c.property_type,
    },
    4,
    selection.length > 0 ? selection : undefined,
  )

  const byRol = new Map(verdicts.map((v) => [v.rol, v]))
  const listing = captacionToParsedListing(c)
  const rescored = scoreCandidatesV3(
    listing,
    prevCandidates.map((cand) => ({
      ...cand,
      visual_score: byRol.get(cand.rol)?.score ?? cand.visual_score ?? null,
      visual_reasons: byRol.get(cand.rol)?.reasons ?? cand.visual_reasons ?? null,
    })),
  )
  const decision = decideMatch(rescored)

  const best = decision.status === 'auto_confirmed' ? decision.best : null
  const { rows } = await pool.query(
    `UPDATE captaciones_cl SET
       sii_rol = COALESCE($2, sii_rol),
       sii_direccion = COALESCE($3, sii_direccion),
       match_score = $4,
       match_confidence = CASE WHEN $2::text IS NOT NULL THEN 'confirmed' ELSE match_confidence END,
       match_method = CASE WHEN $2::text IS NOT NULL THEN 'auto+visual' ELSE match_method END,
       match_signals = COALESCE($5, match_signals),
       candidates = $6,
       stage = CASE WHEN $2::text IS NOT NULL THEN 'matched' ELSE stage END,
       needs_review = $7,
       review_reason = $8,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      captacionId,
      best?.rol ?? null,
      best?.direccion ?? null,
      rescored[0]?.match_score ?? null,
      best ? JSON.stringify(best.match_result_v3.signals) : null,
      JSON.stringify(rescored),
      decision.status === 'needs_review',
      decision.status === 'auto_confirmed' ? null : decision.reason,
    ],
  )
  if (best) await syncListingIdentity(rows[0] as CaptacionRow)
  return { captacion: rows[0] as CaptacionRow, decision, candidates: rescored, visual_usage: usage }
}

/**
 * Selección manual de rol.
 *
 * Acepta tanto un rol de la lista de candidatos como CUALQUIER rol del
 * catastro de la comuna: la lista de candidatos sale del scoring por
 * texto/distancia y a veces el rol correcto ni siquiera aparece en ella (pin
 * corrido varias cuadras, dirección publicada con otro nombre de calle,
 * loteo nuevo). Antes eso era un callejón sin salida — la ficha solo dejaba
 * elegir entre candidatos malos. Ahora el equipo puede señalar la parcela
 * correcta en el mapa (o teclear su rol) y esa decisión humana manda.
 *
 * Prioridad de la evidencia guardada:
 *   1. candidato ya scoreado → conserva su score y señales (match_method 'manual')
 *   2. rol del catastro SII de la comuna → score 1 (match_method 'manual_rol')
 *   3. rol presente solo en cadastre_parcels_cl → score 1, sin dirección SII
 */
export async function selectRolManual(
  captacionId: string,
  rolRaw: string,
  siiComunaCode?: string | null,
): Promise<CaptacionRow> {
  const c = await getCaptacion(captacionId)
  if (!c) throw new Error('Captación no encontrada')

  const rol = normalizeClRol(rolRaw)
  const comuna = siiComunaCode ?? c.sii_comuna_code
  const candidates = (c.candidates ?? []) as ScoredCandidate[]
  const chosen = candidates.find((x) => normalizeClRol(x.rol) === rol)

  let siiRol = chosen?.rol ?? rol
  let direccion = chosen?.direccion ?? null
  let score: number = chosen?.match_score ?? 1
  let signals: unknown = chosen ? chosen.match_result_v3.signals : null
  let method = 'manual'

  if (!chosen) {
    if (!comuna) throw new Error('La captación no tiene comuna SII para resolver el rol')
    method = 'manual_rol'
    // Misma preferencia de fila que /api/chile/sii-rol-detail: un rol puede
    // tener duplicados de ingesta y queremos el que trae datos.
    const { rows: siiRows } = await pool.query(
      `SELECT rol, direccion FROM sii_roles_cl
       WHERE sii_comuna_code = $1 AND rol = $2
       ORDER BY superficie_construida_m2 DESC NULLS LAST,
                (nombre_propietario IS NOT NULL) DESC,
                (lat IS NOT NULL) DESC,
                avaluo_fiscal_total DESC NULLS LAST
       LIMIT 1`,
      [comuna, rol],
    )
    if (siiRows[0]) {
      siiRol = siiRows[0].rol
      direccion = siiRows[0].direccion ?? null
    } else {
      // Sin fila en el catastro SII: se acepta igual si la parcela existe en
      // el catastro gráfico (es lo que el usuario acaba de ver en el mapa).
      const { rows: parcelRows } = await pool.query(
        `SELECT p.rol FROM cadastre_parcels_cl p
         JOIN chile_comunas cc ON cc.id = p.comuna_id
         WHERE cc.sii_comuna_code = $1 AND p.rol = $2
         LIMIT 1`,
        [comuna, rol],
      )
      if (!parcelRows[0]) {
        throw new Error(`El rol ${rol} no existe en el catastro de la comuna ${comuna}`)
      }
      method = 'manual_parcel'
    }
    score = 1
    signals = null
  }

  const { rows } = await pool.query(
    `UPDATE captaciones_cl SET
       sii_rol = $2, sii_direccion = $3, match_score = $4,
       sii_comuna_code = COALESCE($6, sii_comuna_code),
       match_confidence = 'manual', match_method = $7,
       match_signals = $5, stage = 'matched',
       needs_review = false, review_reason = NULL, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [captacionId, siiRol, direccion, score, signals ? JSON.stringify(signals) : null, comuna, method],
  )
  await syncListingIdentity(rows[0] as CaptacionRow)
  return rows[0] as CaptacionRow
}

// ─── Rol SII a partir de un punto (pin corregido a mano en la ficha) ────────

export interface RolAtPoint { rol: string; comuna_name: string; sii_comuna_code: string }

/** Parcela SII que contiene el punto dado (point-in-polygon sobre el catastro
 * ya cargado, mismo criterio que /api/chile/parcels-bbox). Se usa cuando el
 * equipo arrastra el "pin corregido" de la ficha: esa corrección ES la
 * ubicación real, así que el rol se resuelve por geometría en vez de
 * depender del matching de texto/candidatos de matchRol(). */
export async function findRolAtPoint(lat: number, lng: number): Promise<RolAtPoint | null> {
  const { rows } = await pool.query(
    `SELECT p.rol, cc.name AS comuna_name, cc.sii_comuna_code
     FROM cadastre_parcels_cl p
     JOIN chile_comunas cc ON cc.id = p.comuna_id
     WHERE p.rol IS NOT NULL
       AND ST_Contains(p.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
     LIMIT 1`,
    [lng, lat],
  )
  return (rows[0] as RolAtPoint) ?? null
}

/**
 * Fija el rol SII resuelto por geometría (findRolAtPoint) directo sobre la
 * captación — a diferencia de selectRolManual() no exige que el rol esté
 * entre `candidates` (esos vienen del scoring por texto/dirección; un pin
 * arrastrado a mano y cruzado contra el polígono catastral es evidencia más
 * directa que cualquier candidato de esa lista).
 */
export async function setRolFromPin(captacionId: string, rol: string, siiComunaCode: string | null): Promise<CaptacionRow> {
  const { rows } = await pool.query(
    `UPDATE captaciones_cl SET
       sii_rol = $2,
       sii_comuna_code = COALESCE($3, sii_comuna_code),
       match_confidence = 'manual', match_method = 'manual_pin', match_score = 1,
       stage = 'matched', needs_review = false, review_reason = NULL, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [captacionId, rol, siiComunaCode],
  )
  if (!rows[0]) throw new Error('Captación no encontrada')
  await syncListingIdentity(rows[0] as CaptacionRow)
  return rows[0] as CaptacionRow
}

/** Propaga el match al anuncio en listings_cl (dirección exacta + rol). */
async function syncListingIdentity(c: CaptacionRow): Promise<void> {
  if (!c.listing_cl_id || !c.sii_rol) return
  try {
    await pool.query(
      `UPDATE listings_cl SET
         exact_address = $2,
         rol_matriz_candidate = $3,
         identity_score = $4,
         identity_signals = $5,
         location_confidence = CASE WHEN $4 >= 0.92 THEN 'exact' ELSE 'high' END,
         identity_resolved_at = now(),
         updated_at = now()
       WHERE id = $1`,
      [c.listing_cl_id, c.sii_direccion, c.sii_rol, c.match_score, c.match_signals ? JSON.stringify(c.match_signals) : null],
    )
  } catch {
    // 'exact'/'high' pueden no estar en el CHECK de location_confidence en
    // esquemas antiguos — el pipeline no debe morir por eso.
  }
}

// ─── Etapa 3: dueño vía TGR ──────────────────────────────────────────────────

export interface TgrStageResult {
  captacion: CaptacionRow
  from_cache: boolean
  cooldown_ms?: number
}

export async function lookupOwnerTgr(captacionId: string): Promise<TgrStageResult> {
  const c = await getCaptacion(captacionId)
  if (!c) throw new Error('Captación no encontrada')
  if (!c.sii_rol || !c.sii_comuna_code) throw new Error('La captación aún no tiene rol confirmado')

  const rolCompleto = `${c.sii_comuna_code}-${c.sii_rol}`

  // 1) Cache: certificado previo (del scraper masivo o de otra captación)
  const cached = await pool.query(
    `SELECT * FROM tgr_certificados
     WHERE rol = $1 AND estado IN ('exitosa','sin_deuda') AND nombre IS NOT NULL
       AND fecha_consulta > now() - interval '${TGR_CACHE_DAYS} days'
     LIMIT 1`,
    [rolCompleto],
  )
  if (cached.rows[0]) {
    const cert = cached.rows[0]
    const row = await applyTgrResult(c, cert.nombre, cert.direccion, cert.estado === 'sin_deuda' ? 'sin_deuda' : 'ok', null)
    return { captacion: row, from_cache: true }
  }

  const { consultarTgrRol, tgrCooldownRemainingMs } = await import('@/lib/tgr')

  // 2) Cooldown WAF: no intentar siquiera lanzar Chromium
  const cooldown = tgrCooldownRemainingMs()
  if (cooldown > 0) {
    const { rows } = await pool.query(
      `UPDATE captaciones_cl SET tgr_status = 'cooldown', tgr_error = $2, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [captacionId, `WAF TGR en cooldown, reintentar en ${Math.ceil(cooldown / 1000)}s`],
    )
    return { captacion: rows[0], from_cache: false, cooldown_ms: cooldown }
  }

  // 3) Consulta on-demand (serializada dentro de lib/tgr.ts)
  const comunaRes = await pool.query(
    `SELECT name FROM chile_comunas WHERE sii_comuna_code = $1 LIMIT 1`,
    [c.sii_comuna_code],
  )
  const comunaNombre = comunaRes.rows[0]?.name ?? c.comuna_label
  if (!comunaNombre) throw new Error('No se pudo resolver el nombre de la comuna para TGR')

  const [manzana, predio] = c.sii_rol.split('-')
  const cert = await consultarTgrRol(manzana, predio, comunaNombre, rolCompleto)

  // Persistir el certificado en la tabla compartida (mismo ON CONFLICT que la
  // ruta /api/chile/tgr-lookup y el scraper masivo)
  await pool.query(
    `INSERT INTO tgr_certificados (
       rol, comuna, nombre, direccion, total_deuda_no_vencida, total_deuda_morosa,
       total_acogido_art_196_197, tiene_deuda, fecha_emision_certificado, liquidada_al,
       emitido_a_las, codigo_verificacion, estado, intentos, error, fecha_consulta, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14, now(), now())
     ON CONFLICT (rol) DO UPDATE SET
       comuna = excluded.comuna, nombre = excluded.nombre, direccion = excluded.direccion,
       total_deuda_no_vencida = excluded.total_deuda_no_vencida,
       total_deuda_morosa = excluded.total_deuda_morosa,
       total_acogido_art_196_197 = excluded.total_acogido_art_196_197,
       tiene_deuda = excluded.tiene_deuda,
       fecha_emision_certificado = excluded.fecha_emision_certificado,
       liquidada_al = excluded.liquidada_al, emitido_a_las = excluded.emitido_a_las,
       codigo_verificacion = excluded.codigo_verificacion,
       estado = excluded.estado, intentos = tgr_certificados.intentos + 1, error = excluded.error,
       fecha_consulta = now(), updated_at = now()`,
    [
      rolCompleto, cert.comuna, cert.nombre, cert.direccion,
      cert.totalDeudaNoVencida, cert.totalDeudaMorosa, cert.totalAcogidoArt196197,
      cert.tieneDeuda, cert.fechaEmisionCertificado, cert.liquidadaAl, cert.emitidoALas,
      cert.codigoVerificacion, cert.estado, cert.error,
    ],
  )

  if (cert.estado === 'bloqueado') {
    const { rows } = await pool.query(
      `UPDATE captaciones_cl SET tgr_status = 'cooldown', tgr_error = $2, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [captacionId, cert.error ?? 'Bloqueado por WAF de tesoreria.cl'],
    )
    return { captacion: rows[0], from_cache: false, cooldown_ms: tgrCooldownRemainingMs() }
  }
  if (cert.estado === 'error' || !cert.nombre) {
    const { rows } = await pool.query(
      `UPDATE captaciones_cl SET tgr_status = 'error', tgr_error = $2, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [captacionId, cert.error ?? 'El certificado no trae nombre del propietario'],
    )
    return { captacion: rows[0], from_cache: false }
  }

  const row = await applyTgrResult(c, cert.nombre, cert.direccion, cert.estado === 'sin_deuda' ? 'sin_deuda' : 'ok', null)
  return { captacion: row, from_cache: false }
}

/** Aplica el resultado TGR + cruce documental de dirección (verificación 100%). */
async function applyTgrResult(
  c: CaptacionRow,
  ownerName: string | null,
  tgrDireccion: string | null,
  status: 'ok' | 'sin_deuda',
  error: string | null,
): Promise<CaptacionRow> {
  const verified = addressesMatch(tgrDireccion, c.sii_direccion)
  // Si el match fue automático y la dirección TGR NO calza con la SII, la
  // identificación deja de ser confiable: degradar a revisión manual.
  const degrade = !verified && c.match_method === 'auto' && tgrDireccion != null

  const { rows } = await pool.query(
    `UPDATE captaciones_cl SET
       tgr_status = $2, owner_name = $3, tgr_direccion = $4, tgr_error = $5,
       tgr_consulted_at = now(),
       match_verified = $6,
       needs_review = CASE WHEN $7 THEN true ELSE needs_review END,
       review_reason = CASE WHEN $7 THEN 'La dirección del certificado TGR no coincide con la dirección SII del rol elegido' ELSE review_reason END,
       stage = CASE WHEN $3::text IS NOT NULL AND NOT $7 THEN 'owner_found' ELSE stage END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [c.id, status, ownerName, tgrDireccion, error, verified, degrade],
  )
  return rows[0] as CaptacionRow
}

// ─── Etapa 4: contacto vía DealerNet ─────────────────────────────────────────

export interface DealernetStageResult {
  captacion: CaptacionRow
  rut_candidates?: DealernetCandidato[]
}

function candidatoFullName(cand: DealernetCandidato): string {
  return [cand.nombres, cand.apellidos, cand.razonSocial].filter(Boolean).join(' ')
}

export async function lookupContactsDealernet(captacionId: string): Promise<DealernetStageResult> {
  const c = await getCaptacion(captacionId)
  if (!c) throw new Error('Captación no encontrada')
  if (!c.sii_rol || !c.sii_comuna_code) throw new Error('La captación aún no tiene rol confirmado')
  if (!c.owner_name) throw new Error('Primero hay que obtener el nombre del dueño vía TGR')

  const comunaRes = await pool.query(
    `SELECT name FROM chile_comunas WHERE sii_comuna_code = $1 LIMIT 1`,
    [c.sii_comuna_code],
  )
  const comunaNombre: string | null = comunaRes.rows[0]?.name ?? c.comuna_label

  // Buscador Múltiple: por rol → por nombre → por dirección, hasta encontrar
  // candidatos cuyo nombre calce con el dueño TGR.
  const attempts: Array<{ tipo: 'rol' | 'nombre' | 'direccion'; args: string }> = []
  if (comunaNombre) attempts.push({ tipo: 'rol', args: `${c.sii_rol}, ${comunaNombre}` })
  attempts.push({ tipo: 'nombre', args: c.owner_name })
  if (c.sii_direccion && comunaNombre) attempts.push({ tipo: 'direccion', args: `${c.sii_direccion}, ${comunaNombre}` })

  let allCandidates: DealernetCandidato[] = []
  let lastError: string | null = null
  let chosen: DealernetCandidato | null = null

  for (const attempt of attempts) {
    try {
      const cached = await getCachedBuscadorMultiple(attempt.tipo, attempt.args)
      const res = cached ?? await queryDealernetBuscadorMultiple(attempt.tipo, attempt.args)
      const retErr = dealernetRetcodeMessage(res.retcode)
      if (retErr) {
        await logDealernetQuery({ kind: 'buscador_multiple', tipbusq: attempt.tipo, args: attempt.args, retcode: res.retcode, success: false, fromCache: !!cached, source: 'captacion', error: retErr })
        lastError = `DealerNet (${attempt.tipo}): ${retErr}`; continue
      }
      if (!cached) await saveBuscadorMultipleCache(attempt.tipo, attempt.args, { ...res, raw: (res as any).raw ?? null })
      await logDealernetQuery({ kind: 'buscador_multiple', tipbusq: attempt.tipo, args: attempt.args, retcode: res.retcode, success: true, fromCache: !!cached, candidatosN: res.candidatos.length, source: 'captacion' })
      const withRut = res.candidatos.filter((x) => x.rut != null)
      allCandidates = allCandidates.concat(withRut)
      const scored = withRut
        .map((cand) => ({ cand, sim: nameSimilarity(c.owner_name, candidatoFullName(cand)) }))
        .sort((a, b) => b.sim - a.sim)
      if (scored[0] && scored[0].sim >= OWNER_NAME_MATCH_THRESHOLD) {
        const second = scored[1]
        // Si dos RUT distintos matchean igual de bien, es ambiguo
        if (!second || second.sim < scored[0].sim || second.cand.rut === scored[0].cand.rut) {
          chosen = scored[0].cand
          break
        }
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'Error consultando DealerNet'
    }
  }

  if (!chosen) {
    const status = allCandidates.length > 0 ? 'ambiguous' : 'not_found'
    const { rows } = await pool.query(
      `UPDATE captaciones_cl SET
         dealernet_status = $2, owner_rut_candidates = $3, dealernet_error = $4,
         dealernet_consulted_at = now(),
         needs_review = CASE WHEN $2 = 'ambiguous' THEN true ELSE needs_review END,
         review_reason = CASE WHEN $2 = 'ambiguous' THEN 'Varios RUT candidatos en DealerNet: elegir manualmente' ELSE review_reason END,
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [captacionId, status, JSON.stringify(allCandidates.slice(0, 15)), lastError],
    )
    return { captacion: rows[0], rut_candidates: allCandidates.slice(0, 15) }
  }

  return finishDealernetByRut(c, chosen.rut!, chosen.dv ?? computeRutDv(chosen.rut!), allCandidates)
}

/** Consulta final por RUT (productos de contactabilidad) y persistencia. */
export async function finishDealernetByRut(
  c: CaptacionRow,
  rutNum: number,
  rutDv: string,
  allCandidates: DealernetCandidato[] = [],
): Promise<DealernetStageResult> {
  // Este mismo RUT puede ya estar guardado (ficha del rol en /chile/catastro,
  // /chile/dealer, u otra captación) — reusar evita pagar la consulta de nuevo.
  const cached = await getCachedContactByRut(rutNum, rutDv, DEFAULT_DEALERNET_PRODUCTS)

  let phones: { phone_e164: string; clasificacion: string | null; categoria: string; ind_whatsapp: boolean | null; product_code: string; calidad: number | null }[]
  let emails: { email: string; categoria: string; product_code: string }[]

  if (cached) {
    phones = cached.phones as any
    emails = cached.emails as any
    await logDealernetQuery({ kind: 'contactos_rut', rutNum, rutDv, productCodes: DEFAULT_DEALERNET_PRODUCTS, retcode: cached.contact.retcode, success: true, fromCache: true, candidatosN: cached.phones.length, source: 'captacion' })
    if (c.sii_rol && c.sii_comuna_code && (!cached.contact.sii_rol || !cached.contact.sii_comuna_code)) {
      await pool.query(
        `UPDATE dealernet_contacts_cl SET sii_rol = COALESCE(sii_rol, $2), sii_comuna_code = COALESCE(sii_comuna_code, $3) WHERE id = $1`,
        [cached.contact.id, c.sii_rol, c.sii_comuna_code]
      )
    }
  } else {
    const lookup = await queryDealernet({ num: rutNum, dv: rutDv }, DEFAULT_DEALERNET_PRODUCTS)
    const retErr = dealernetRetcodeMessage(lookup.retcode)
    if (retErr) {
      await logDealernetQuery({ kind: 'contactos_rut', rutNum, rutDv, productCodes: DEFAULT_DEALERNET_PRODUCTS, retcode: lookup.retcode, success: false, fromCache: false, source: 'captacion', error: retErr })
      const { rows } = await pool.query(
        `UPDATE captaciones_cl SET dealernet_status = 'error', dealernet_error = $2,
           dealernet_consulted_at = now(), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [c.id, `DealerNet: ${retErr}`],
      )
      return { captacion: rows[0] }
    }
    await logDealernetQuery({ kind: 'contactos_rut', rutNum, rutDv, productCodes: DEFAULT_DEALERNET_PRODUCTS, retcode: lookup.retcode, success: true, fromCache: false, candidatosN: lookup.phones.length, source: 'captacion' })

    // Persistir en las tablas compartidas de DealerNet (cache reutilizable por
    // /chile/duenos, /dealer, la ficha del rol y otras captaciones)
    try {
      const contactRes = await pool.query(
        `INSERT INTO dealernet_contacts_cl
           (rut_num, rut_dv, sii_rol, sii_comuna_code, nombre_titular, products_requested, retcode, retmsg, raw_response, portal_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (rut_num, rut_dv) DO UPDATE SET
           sii_rol = COALESCE(EXCLUDED.sii_rol, dealernet_contacts_cl.sii_rol),
           sii_comuna_code = COALESCE(EXCLUDED.sii_comuna_code, dealernet_contacts_cl.sii_comuna_code),
           nombre_titular = COALESCE(EXCLUDED.nombre_titular, dealernet_contacts_cl.nombre_titular),
           products_requested = ARRAY(
             SELECT DISTINCT unnest(dealernet_contacts_cl.products_requested || EXCLUDED.products_requested)
           ),
           retcode = EXCLUDED.retcode, retmsg = EXCLUDED.retmsg,
           raw_response = EXCLUDED.raw_response,
           portal_url = COALESCE(EXCLUDED.portal_url, dealernet_contacts_cl.portal_url)
         RETURNING id`,
        [rutNum, rutDv, c.sii_rol, c.sii_comuna_code, lookup.nombreTitular, lookup.productsRequested,
         lookup.retcode, lookup.retmsg, JSON.stringify(lookup.raw), c.source_url],
      )
      const contactId = contactRes.rows[0].id
      for (const phone of lookup.phones) {
        await pool.query(
          `INSERT INTO dealernet_phones_cl
             (contact_id, phone_e164, phone_raw, categoria, clasificacion, ind_whatsapp, idimagen, relacion, ranking, calidad, product_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (contact_id, phone_e164, product_code) DO UPDATE SET
             categoria = EXCLUDED.categoria, ranking = EXCLUDED.ranking, calidad = EXCLUDED.calidad`,
          [contactId, phone.phone_e164, phone.phone_raw, phone.categoria, phone.clasificacion,
           phone.ind_whatsapp, phone.idimagen, phone.relacion, phone.ranking, phone.calidad, phone.product_code],
        )
      }
    } catch {
      // cache compartido es secundario — los teléfonos quedan igual en captaciones_cl
    }

    phones = lookup.phones
    emails = lookup.emails
  }

  const phonesJson = phones.map((p) => ({
    numero: p.phone_e164,
    tipo: p.clasificacion,
    categoria: p.categoria,
    whatsapp: p.ind_whatsapp,
    fuente: p.product_code,
    calidad: p.calidad,
  }))
  const emailsJson = emails.map((e) => ({ email: e.email, categoria: e.categoria, fuente: e.product_code }))

  const { rows } = await pool.query(
    `UPDATE captaciones_cl SET
       dealernet_status = 'ok',
       owner_rut = $2,
       owner_rut_candidates = $3,
       phones = $4,
       emails = $5,
       dealernet_error = NULL,
       dealernet_consulted_at = now(),
       stage = CASE WHEN $6::int > 0 THEN 'contact_found' ELSE stage END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [c.id, `${rutNum}-${rutDv}`, JSON.stringify(allCandidates.slice(0, 15)),
     JSON.stringify(phonesJson), JSON.stringify(emailsJson), phonesJson.length],
  )
  return { captacion: rows[0] as CaptacionRow }
}
