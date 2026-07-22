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
//   platform: 'convecta' | 'ofinet'
//   listUrl(domain, { operation, propertyType, page }) -> string
//     URL del listado de inventario para ese dominio/filtros.
//   parseList(html, { domain }) -> Array<{ url, seller_reference? }>
//     Enlaces a fichas individuales presentes en el HTML del listado. Puede
//     devolver [] si el listado se carga por AJAX (ver nota H2/H21 abajo).
//   parseDetail(html, { url, domain }) -> ListingCl | null
//     Ficha individual normalizada, lista para upsertListingCl (source_type
//     'agency_web', portal 'web:<domain>'). El campo CLAVE es seller_reference:
//     el código interno que engancha el enlace determinista Nivel 1.5 (H21).
//
// AJAX (resolución del conflicto H2/H21): el listado de Convecta no trae enlaces
// a fichas en el HTML estático (se cargan por JS). parseList devuelve [] en ese
// caso; el descubrimiento de "inventario oculto" completo necesita el endpoint
// XHR real (investigación de Fase 0/4) o un navegador acotado. Pero el enlace
// determinista básico (PI ↔ web propia por código interno) NO depende del
// listado: opera sobre la ficha individual, que suele ser HTML estático.
// ─────────────────────────────────────────────────────────────────────────────
import { load } from 'cheerio'
import { normalizeDomain } from '../detect-corredora-crm-cl.mjs'
import * as convecta from './convecta.mjs'
import * as ofinet from './ofinet.mjs'

const ADAPTERS = { convecta, ofinet }

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
// ASP.NET (.asp/.aspx) con maquetados distintos, pero los datos numéricos se
// escriben parecido. Estos helpers son defensivos: prueban varios patrones y
// devuelven null si no encuentran, para no inventar datos.

/** Limpia espacios/no-break y recorta. */
export function clean(s) {
  return (s == null ? '' : String(s)).replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Parsea un precio en CLP o UF desde texto libre. Devuelve { clp, uf, currency }.
 * Reconoce "$ 320.000.000", "UF 12.500", "12.500 UF", "CLP 320000000".
 * Los miles en Chile van con punto y los decimales con coma — se descartan
 * decimales (no aplican a precios de propiedad).
 */
export function parsePrice(text) {
  const t = clean(text)
  if (!t) return { clp: null, uf: null, currency: null }
  const isUf = /\buf\b/i.test(t)
  // Toma el primer grupo de dígitos con separadores de miles.
  const m = t.match(/(\d{1,3}(?:[.\s]\d{3})+|\d{4,})/)
  if (!m) return { clp: null, uf: null, currency: null }
  const n = Number(m[1].replace(/[.\s]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return { clp: null, uf: null, currency: null }
  return isUf
    ? { clp: null, uf: n, currency: 'UF' }
    : { clp: n, uf: null, currency: 'CLP' }
}

/** Extrae un entero de metros cuadrados desde texto ("120 m²", "120,5 m2"). */
export function parseSqm(text) {
  const t = clean(text)
  const m = t.match(/(\d{1,3}(?:[.,]\d+)?)\s*m(?:2|²)/i)
  if (!m) return null
  const n = Math.round(Number(m[1].replace(',', '.')))
  return Number.isFinite(n) && n > 0 ? n : null
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
 * Código interno de la corredora (seller_reference), la clave del enlace Nivel
 * 1.5. Se busca con etiquetas típicas ("Código", "Cód.", "Ref.", "Rol interno")
 * y como fallback en la URL. Formato libre (ej. OR58124, 1234, MG-882).
 */
export function parseInternalCode(text, url = '') {
  const t = clean(text)
  const labeled = t.match(/(?:c[oó]digo|c[oó]d\.?|ref(?:erencia)?\.?|rol\s+interno)\s*[:#]?\s*([A-Z]{0,4}-?\d{2,8}[A-Z]?)/i)
  if (labeled) return labeled[1].toUpperCase()
  // Fallback: ?id=1234 / /propiedad/1234 / -1234.html en la URL.
  const fromUrl = String(url).match(/(?:[?&](?:id|cod|codigo|ref)=|\/)(\d{3,8})(?:[.\-/?&]|$)/i)
  return fromUrl ? fromUrl[1] : null
}

/** Deduplica y filtra a URLs absolutas de imágenes plausibles. */
export function cleanPhotos(urls) {
  const seen = new Set()
  const out = []
  for (const u of urls) {
    const s = clean(u)
    if (!s || !/^https?:\/\//i.test(s)) continue
    if (!/\.(jpe?g|png|webp|avif)(\?|$)/i.test(s)) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/** Operación desde texto ("En Venta"/"Arriendo") → 'sale'|'rent'|null. */
export function parseOperation(text) {
  const t = clean(text).toLowerCase()
  if (/arriend|arrend/.test(t)) return 'rent'
  if (/venta|vende/.test(t)) return 'sale'
  return null
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

function fieldNear(text, labelSrc) {
  const t = clean(text)
  // Formato "Dormitorios: 4" (etiqueta con plural + separador BREVE + número).
  // Va PRIMERO: en "Dormitorios: 4 Baños: 3" el número correcto de baños es el
  // que sigue a "Baños", no el 4 que lo precede (que es de dormitorios).
  const after = t.match(new RegExp(`(?:${labelSrc})(?:es|s)?\\s*[:#.]?\\s*(\\d{1,2})\\b`, 'i'))
  if (after) return parseSmallInt(after[1])
  // Fallback "4 Dormitorios" → número pegado antes de la etiqueta.
  const before = t.match(new RegExp(`(\\d{1,2})\\s*(?:${labelSrc})`, 'i'))
  if (before) return parseSmallInt(before[1])
  return null
}

function parseComunaFrom(bodyText) {
  const labeled = clean(bodyText).match(/comuna\s*[:#]?\s*([A-Za-zÁÉÍÓÚÑáéíóúñ ]{3,30})/i)
  if (!labeled) return null
  // La captura puede arrastrar la etiqueta del campo siguiente ("Providencia
  // Cód", "Las Condes Código"). Cortamos ante cualquier etiqueta conocida —
  // preservando comunas de dos palabras (Las Condes, Lo Barnechea).
  const cut = clean(labeled[1]).replace(
    /\s+(precio|tipo|operaci|regi[oó]n|c[oó]d|c[oó]digo|ref|rol|dormitor|ba[ñn]o|superficie|estado).*$/i,
    ''
  ).trim()
  return cut || null
}

function parsePhoneFrom(text) {
  const m = clean(text).match(/(?:\+?56\s?)?(?:9\s?\d{4}\s?\d{4}|2\s?\d{3}\s?\d{4})/)
  return m ? m[0].replace(/\s+/g, '') : null
}

function hashUrl(url) {
  let h = 0
  const s = String(url)
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/**
 * Parser de ficha compartido por los adaptadores ASP.NET (Convecta/Ofinet):
 * ambos escriben los datos con la misma forma, solo cambia la URL de listado.
 * Devuelve un objeto normalizado para upsertListingCl, o null si no logra
 * extraer lo mínimo (ni código interno ni precio → no aporta al enlace Nivel 1.5).
 *
 * @param {string} html
 * @param {{ url?: string, domain?: string, platform?: string }} ctx
 */
export function parseDetailGeneric(html, { url = '', domain = '', platform = '' } = {}) {
  if (!html) return null
  const d = normalizeDomain(domain) || normalizeDomain(url)
  const $ = load(html)

  const bodyText = clean($('body').text()) || clean($.root().text())
  const title = clean($('meta[property="og:title"]').attr('content') || $('h1').first().text() || $('title').text())

  const priceText =
    clean($('[class*="precio" i], [class*="price" i], [itemprop="price"]').first().text()) ||
    clean($('meta[property="product:price:amount"]').attr('content')) ||
    (bodyText.match(/(?:UF|US?\$|CLP)\s*[\d.\s]+/i)?.[0] ?? '')
  const { clp, uf, currency } = parsePrice(priceText)

  const featText = clean($('[class*="caracter" i], [class*="detalle" i], [class*="ficha" i], ul, table').text()) || bodyText

  const bedrooms = fieldNear(featText, 'dormitorio|dorm\\.?|habitaci')
  const bathrooms = fieldNear(featText, 'ba(?:ñ|n)os?')
  const square_meters = parseSqm(
    featText.match(/superficie\s+(?:[uú]til|construida|interior|total)[^\d]*(\d[\d.,]*\s*m(?:2|²))/i)?.[1] || featText
  )

  const seller_reference = parseInternalCode(featText, url) || parseInternalCode(title, url)
  const operation = parseOperation(title) || parseOperation(bodyText)
  const property_type = parsePropertyType(title) || parsePropertyType(bodyText)
  const comuna = parseComunaFrom(bodyText)

  const imgs = []
  $('img[src], img[data-src]').each((_, el) => { imgs.push($(el).attr('data-src'), $(el).attr('src')) })
  $('a[href*=".jpg" i], a[href*=".jpeg" i], a[href*=".png" i], a[href*=".webp" i]').each((_, el) => { imgs.push($(el).attr('href')) })
  imgs.push($('meta[property="og:image"]').attr('content'))
  const photos = cleanPhotos(imgs.filter(Boolean))

  if (!seller_reference && clp == null && uf == null) return null

  const external_id = seller_reference ? `${d}:${seller_reference}` : `${d}:${hashUrl(url)}`

  return {
    portal: `web:${d}`,
    source_type: 'agency_web',
    external_id,
    source_url: url || null,
    operation,
    property_type,
    advertiser_type: 'agency',
    advertiser_name: null,
    phone: parsePhoneFrom(bodyText),
    price: clp,
    price_uf: uf,
    currency: currency || 'CLP',
    bedrooms,
    bathrooms,
    square_meters,
    comuna,
    address: null,
    latitude: null,
    longitude: null,
    description: clean($('meta[property="og:description"]').attr('content') || $('[class*="descrip" i]').first().text()) || null,
    photos,
    property_code: null,
    advertiser_id: null,
    seller_reference,
    crm_platform: platform || null,
  }
}

/**
 * Enlaces a fichas presentes en el HTML de un listado. Heurística compartida:
 * <a href> que apunten a fichas de propiedad. Devuelve [] si el listado se
 * carga por AJAX (el HTML estático no trae los enlaces).
 */
export function parseListGeneric(html, { domain = '' } = {}) {
  if (!html) return []
  const d = normalizeDomain(domain)
  const $ = load(html)
  const out = []
  const seen = new Set()
  $('a[href]').each((_, el) => {
    const href = clean($(el).attr('href'))
    if (!href) return
    if (!/(propiedad|ficha|detalle|inmueble|listing)/i.test(href) && !/\.aspx?\?[^"']*\bid=/i.test(href)) return
    let abs = href
    if (/^\//.test(href)) abs = `https://www.${d}${href}`
    else if (!/^https?:\/\//i.test(href)) abs = `https://www.${d}/${href.replace(/^\.?\//, '')}`
    if (seen.has(abs)) return
    seen.add(abs)
    out.push({ url: abs })
  })
  return out
}
