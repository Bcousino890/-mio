// ─────────────────────────────────────────────────────────────────────────────
// crm-adapters/ — adaptadores multi-tenant de CRM inmobiliarios chilenos
// (plan Anuncios CL · Fase 4 / H21).
//
// "Un adaptador, N dominios." La mayoría de corredoras chilenas corren su web
// sobre un puñado de CRM (Convecta, Ofinet, …). Cuando el detector
// (detect-corredora-crm-cl.mjs) reconoce la plataforma, se usa el adaptador de
// esa plataforma para CUALQUIER dominio registrado en corredora_web_targets_cl
// (0069) — así "scrapear una corredora nueva" es solo añadir una fila + apuntar
// al adaptador correcto, no escribir código nuevo.
//
// CONTRATO común de cada adaptador (crm-adapters/<platform>.mjs):
//   platform: 'convecta' | 'ofinet' | 'konnect'
//   listUrl(domain, { operation, page, baseUrl }) -> string
//     URL de UNA página del listado de inventario.
//   parseList(body, { domain, baseUrl })
//       -> { items: Array<{ url, seller_reference, listing? }>, total, lastPage }
//     Fichas presentes en esa página, más lo que el sitio declare: `total` =
//     cuántas fichas dice tener el buscador (null si no lo publica), `lastPage`
//     = última página conocida (null si su paginador no es de fiar). El crawler
//     usa ambos para decidir cuándo parar; ver nota de PAGINACIÓN.
//   detailUrl(domain, ref, { baseUrl }) -> string
//     URL de la ficha a partir del código interno.
//   parseDetail(body, { url, domain }) -> ListingCl | null
//     Ficha individual normalizada, lista para upsertListingCl (source_type
//     'agency_web', portal 'web:<domain>'). El campo CLAVE es seller_reference:
//     el código interno que engancha el enlace determinista Nivel 1.5 (H21).
//
// Banderas opcionales que el adaptador declara y el crawler respeta:
//   listIsJson      el listado responde JSON (no pasar por un parser de DOM).
//   listIsComplete  el listado ya trae la ficha entera en `item.listing` → no
//                   hay que descargar la ficha una por una (Konnect).
//   requiresSession el sitio guarda el filtro en la sesión y la paginación
//                   depende de la cookie (Ofinet) → cookie jar por target.
//   pageSize        fichas por página, para deducir cuántas pedir desde `total`.
//
// PAGINACIÓN — la lección que costó más cara de esta investigación. Ninguna de
// las tres plataformas permite el mismo criterio de parada:
//   · Convecta publica `numRegistros` (total exacto) → páginas = total/pageSize.
//   · Konnect publica `pagination.maxPages` → acotado de antemano.
//   · Ofinet no publica nada Y su paginador es una ventana deslizante que en la
//     página 1 solo enseña hasta la 4 aunque haya 85. Leer "la última página"
//     de ahí daba 36 fichas de las 759 reales.
// Por eso `total`/`lastPage` son null-ables y el crawler SIEMPRE acepta la
// página vacía como fin, use o no la cuenta declarada.
// ─────────────────────────────────────────────────────────────────────────────
import { normalizeDomain } from '../detect-corredora-crm-cl.mjs'
import * as convecta from './convecta.mjs'
import * as ofinet from './ofinet.mjs'
import * as konnect from './konnect.mjs'

const ADAPTERS = { convecta, ofinet, konnect }

/**
 * Origen absoluto del sitio, sin barra final.
 *
 * `baseUrl` (columna base_url de corredora_web_targets_cl, 0088) manda cuando
 * está: derivar la URL del dominio NO es seguro — www.ppartnersgroup.com
 * redirige a la portada en inglés, y hay dominios que solo responden sin www.
 * Sin baseUrl se cae a la convención histórica "https://www.<dominio>", que
 * sigue siendo correcta para la mayoría.
 */
export function siteBase(domain, baseUrl = null, { www = true } = {}) {
  const explicit = String(baseUrl ?? '').trim().replace(/\/+$/, '')
  if (/^https?:\/\/[^/]+$/.test(explicit)) return explicit
  const d = normalizeDomain(domain)
  if (!d) return ''
  return www ? `https://www.${d}` : `https://${d}`
}

/**
 * Devuelve el adaptador para una plataforma, o null si no hay uno soportado
 * ('other'/'unknown' → sin adaptador automático).
 * @param {string} platform
 */
export function getAdapter(platform) {
  return ADAPTERS[platform] ?? null
}

export const SUPPORTED_PLATFORMS = Object.keys(ADAPTERS)

// ─── Helpers de extracción compartidos por los adaptadores ───────────────────
// Defensivos a propósito: devuelven null cuando no encuentran, en vez de
// adivinar. Un campo vacío se ve y se corrige; un campo inventado se propaga a
// la ficha, al dedup y al análisis de mercado sin que nadie lo note.
//
// NO hay aquí un parseDetail "genérico". Lo hubo, compartido por Convecta y
// Ofinet bajo la idea de que "ambos son ASP.NET y escriben los datos parecido",
// y contra el HTML real de las tres corredoras daba: el código interno truncado
// a "12" en vez de "12828" (lo que rompe justo el enlace determinista para el
// que existe el campo), 2 dormitorios en una ficha de 4, la comuna leída como
// "s Comuna", una foto de diecisiete y la operación invertida. Barrer texto
// plano con regex no distingue los campos de la ficha de los del sidebar de
// propiedades relacionadas. Cada plataforma parsea su propia estructura.

/** Limpia espacios/no-break y recorta. */
export function clean(s) {
  return (s == null ? '' : String(s)).replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

/** Extrae un entero pequeño (dorm/baños) que precede/sigue a una etiqueta. */
export function parseSmallInt(text) {
  const t = clean(text)
  const m = t.match(/\d{1,2}/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

/**
 * Deduplica y filtra a URLs absolutas de imágenes plausibles.
 *
 * La deduplicación NO puede ser por cadena exacta: la misma foto llega escrita
 * de varias formas en la misma página y colarla dos veces infla el recuento y
 * ensucia el dedup por imagen. Vistas en los sitios reales:
 *   · barra doble en la ruta — la galería sirve "cdn//elbarrio/img/x.jpg" y el
 *     og:image "cdn/elbarrio/img/x.jpg";
 *   · querystring de firma — la galería añade el token SAS del blob de Azure
 *     ("…jpeg?sv=…&sig=…") y el og:image no.
 * Se compara por ruta normalizada sin query, y se conserva la PRIMERA aparición:
 * los adaptadores empujan primero las de galería, que son las que llevan el
 * token que el CDN exige, y el og:image al final como respaldo.
 */
export function cleanPhotos(urls) {
  const seen = new Set()
  const out = []
  for (const u of urls) {
    const s = clean(u)
    if (!s || !/^https?:\/\//i.test(s)) continue
    if (!/\.(jpe?g|png|webp|avif)(\?|$)/i.test(s)) continue
    // El esquema se separa antes de colapsar barras, para no destrozar el
    // "https://" al normalizar el "//" que la galería mete en la ruta.
    const [esquema, resto = ''] = s.split(/[?#]/)[0].split('://')
    const key = (resto ? `${esquema}://${resto.replace(/\/{2,}/g, '/')}` : esquema).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

/** Tipo de propiedad grosero desde texto → 'casa'|'departamento'|... o null. */
export function parsePropertyType(text) {
  const t = clean(text).toLowerCase()
  if (/departamento|depto/.test(t)) return 'departamento'
  if (/casa/.test(t)) return 'casa'
  if (/oficina/.test(t)) return 'oficina'
  if (/terreno|sitio|parcela/.test(t)) return 'terreno'
  if (/local/.test(t)) return 'local'
  if (/bodega/.test(t)) return 'bodega'
  return null
}
