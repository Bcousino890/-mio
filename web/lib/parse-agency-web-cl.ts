// parse-agency-web-cl.ts — Duplicado (TS) del parser genérico de fichas de la
// WEB PROPIA de una corredora que vive en
// `scraper/lib/crm-adapters/index.mjs` (`parseDetailGeneric`). Mismo motivo que
// `parse-portalinmobiliario-cl.ts` y `geocode-cl.ts`: web/ y scraper/ son
// proyectos Node separados y el build Docker de web/ no incluye scraper/lib.
//
// Diferencia de implementación: el .mjs usa cheerio y aquí se hace con regex,
// porque web/ no lo tiene entre sus dependencias (y añadirlo para esto sería
// arrastrar un parser de HTML entero al bundle de Next). Las heurísticas —qué
// es un precio, qué es un código interno, qué es una foto— son las mismas.
//
// Para qué sirve: cuando alguien pega en el buscador de /chile/propiedades la
// URL de una ficha de la web de una corredora (no de Portal Inmobiliario) y esa
// ficha no está en la base, hay que poder traerla igual. El barrido 24/7 ya lo
// hace por dominio configurado (crawl-corredora-web-cl.mjs); esto es el mismo
// parseo para UNA url suelta, a petición.

const NAMED: Record<string, string> = {
  euro: '€', sup2: '²', sup3: '³', nbsp: ' ', amp: '&', quot: '"', apos: "'",
  lt: '<', gt: '>', ordf: 'ª', ordm: 'º', deg: '°', middot: '·', hellip: '…',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ',
  uuml: 'ü', Uuml: 'Ü', ndash: '–', mdash: '—', laquo: '«', raquo: '»',
}

/** Texto limpio: sin entidades, sin etiquetas y con los espacios colapsados. */
export function clean(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED[name] ?? m)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** El HTML sin `<script>`/`<style>`/etiquetas: solo el texto visible. */
function textoDelHtml(html: string): string {
  return clean(
    html
      .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
}

/** Contenido de un `<meta>` por `property`/`name` (og:title, og:image…). */
function meta(html: string, clave: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${clave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
    'i',
  )
  const tag = html.match(re)?.[0]
  if (!tag) return null
  const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1]
  return content ? clean(content) : null
}

/** Texto del primer elemento de una etiqueta (`h1`, `title`…). */
function primerElemento(html: string, etiqueta: string): string | null {
  const m = html.match(new RegExp(`<${etiqueta}\\b[^>]*>([\\s\\S]*?)<\\/${etiqueta}>`, 'i'))
  return m ? clean(m[1].replace(/<[^>]+>/g, ' ')) : null
}

// Texto del primer elemento cuya `class`/`itemprop` mencione algo (el
// equivalente al selector `[class*="precio" i]` que usa la versión con cheerio).
// Hace falta de verdad: el respaldo de buscar el precio en el texto de la
// página solo reconoce el importe si lleva su moneda escrita delante, y las
// fichas que ponen `<div class="price">$ 750.000</div>` se quedaban sin precio.
function textoDeElementoCon(html: string, palabras: string): string | null {
  const m = html.match(new RegExp(
    `<([a-z][a-z0-9]*)\\b[^>]*(?:class|itemprop)\\s*=\\s*["'][^"']*(?:${palabras})[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    'i',
  ))
  return m ? clean(m[2].replace(/<[^>]+>/g, ' ')) : null
}

export type PrecioParseado = { clp: number | null; uf: number | null; currency: string | null }

/**
 * Precio en CLP o UF desde texto libre: "$ 320.000.000", "UF 12.500",
 * "12.500 UF". En Chile los miles van con punto y los decimales con coma; los
 * decimales se descartan (no aplican a precios de propiedad).
 */
export function parsePrice(text: string | null | undefined): PrecioParseado {
  const t = clean(text)
  if (!t) return { clp: null, uf: null, currency: null }
  const esUf = /\buf\b/i.test(t)
  const m = t.match(/(\d{1,3}(?:[.\s]\d{3})+|\d{4,})/)
  if (!m) return { clp: null, uf: null, currency: null }
  const n = Number(m[1].replace(/[.\s]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return { clp: null, uf: null, currency: null }
  return esUf ? { clp: null, uf: n, currency: 'UF' } : { clp: n, uf: null, currency: 'CLP' }
}

/** Metros cuadrados como entero ("120 m²", "120,5 m2"). */
export function parseSqm(text: string | null | undefined): number | null {
  const m = clean(text).match(/(\d{1,3}(?:[.,]\d+)?)\s*m(?:2|²)/i)
  if (!m) return null
  const n = Math.round(Number(m[1].replace(',', '.')))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Código interno de la corredora: la clave con la que el dedup une esta ficha
 * con el anuncio que la misma corredora publica en el portal. Se busca por
 * etiqueta ("Código", "Cód.", "Ref.") y, si no, en la propia URL.
 */
export function parseInternalCode(text: string | null | undefined, url = ''): string | null {
  const t = clean(text)
  const etiquetado = t.match(/(?:c[oó]digo|c[oó]d\.?|ref(?:erencia)?\.?|rol\s+interno)\s*[:#]?\s*([A-Z]{0,4}-?\d{2,8}[A-Z]?)/i)
  if (etiquetado) return etiquetado[1].toUpperCase()
  const deLaUrl = String(url).match(/(?:[?&](?:id|cod|codigo|ref)=|\/)(\d{3,8})(?:[.\-/?&]|$)/i)
  return deLaUrl ? deLaUrl[1] : null
}

/** Operación desde texto ("En Venta" / "Arriendo"). */
export function parseOperation(text: string | null | undefined): 'sale' | 'rent' | null {
  const t = clean(text).toLowerCase()
  if (/arriend|arrend/.test(t)) return 'rent'
  if (/venta|vende/.test(t)) return 'sale'
  return null
}

/** Tipo de propiedad grosero desde texto. */
export function parsePropertyType(text: string | null | undefined): string | null {
  const t = clean(text).toLowerCase()
  if (/departamento|depto/.test(t)) return 'departamento'
  if (/casa/.test(t)) return 'casa'
  if (/oficina/.test(t)) return 'oficina'
  if (/terreno|sitio|parcela/.test(t)) return 'terreno'
  if (/local/.test(t)) return 'local'
  if (/bodega/.test(t)) return 'bodega'
  return null
}

/** Entero pequeño (dormitorios/baños) junto a su etiqueta. */
function campoJuntoA(text: string, etiqueta: string): number | null {
  const t = clean(text)
  // "Dormitorios: 4" va PRIMERO: en "Dormitorios: 4 Baños: 3" el número de
  // baños es el que SIGUE a "Baños", no el 4 que lo precede.
  const despues = t.match(new RegExp(`(?:${etiqueta})(?:es|s)?\\s*[:#.]?\\s*(\\d{1,2})\\b`, 'i'))
  if (despues) return Number(despues[1])
  const antes = t.match(new RegExp(`(\\d{1,2})\\s*(?:${etiqueta})`, 'i'))
  return antes ? Number(antes[1]) : null
}

function comunaDe(texto: string): string | null {
  const etiquetada = clean(texto).match(/comuna\s*[:#]?\s*([A-Za-zÁÉÍÓÚÑáéíóúñ ]{3,30})/i)
  if (!etiquetada) return null
  // La captura arrastra la etiqueta del campo siguiente ("Las Condes Código"):
  // se corta ante cualquier etiqueta conocida, sin partir las comunas de dos
  // palabras (Las Condes, Lo Barnechea).
  const cortada = clean(etiquetada[1]).replace(
    /\s+(precio|tipo|operaci|regi[oó]n|c[oó]d|c[oó]digo|ref|rol|dormitor|ba[ñn]o|superficie|estado).*$/i,
    '',
  ).trim()
  return cortada || null
}

/** Fotos: absolutas, con extensión de imagen y sin repetir. */
export function cleanPhotos(urls: Array<string | null | undefined>): string[] {
  const vistas = new Set<string>()
  const out: string[] = []
  for (const u of urls) {
    const s = clean(u)
    if (!s || !/^https?:\/\//i.test(s)) continue
    if (!/\.(jpe?g|png|webp|avif)(\?|$)/i.test(s)) continue
    if (vistas.has(s)) continue
    vistas.add(s)
    out.push(s)
  }
  return out
}

// Dominio desnudo: sin protocolo, sin `www.`, sin ruta, sin query y sin puerto.
// Es la identidad de la corredora en la base (`portal = 'web:<dominio>'` y la
// primera mitad de `external_id`), así que tiene que salir igual escriba quien
// escriba la URL. Misma normalización que `normalizeDomain` de
// scraper/lib/detect-corredora-crm-cl.mjs, que es quien la fija para el
// barrido 24/7: si las dos difieren, la misma ficha entra dos veces.
export function normalizeDomain(input: string): string {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .replace(/:\d+$/, '')
    .trim()
}

// Sin código interno la ficha necesita igualmente un id estable: el mismo hash
// de la URL que usa el crawler, para que volver a pedir la misma URL actualice
// la fila en vez de duplicarla.
function hashUrl(url: string): string {
  let h = 0
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0
  return h.toString(36)
}

export type AgencyWebListing = {
  portal: string
  source_type: 'agency_web'
  external_id: string
  source_url: string
  title: string | null
  operation: string | null
  property_type: string | null
  price: number | null
  price_uf: number | null
  currency: string
  bedrooms: number | null
  bathrooms: number | null
  square_meters: number | null
  comuna: string | null
  description: string | null
  photos: string[]
  seller_reference: string | null
}

/**
 * Parsea la ficha de la web propia de una corredora. Devuelve null si no
 * consigue ni el código interno ni el precio: sin ninguno de los dos no hay
 * ficha que valga la pena guardar (y casi siempre significa que lo descargado
 * no era una ficha — un listado, un error, o una página cargada por JS).
 */
export function parseAgencyWebListing(html: string, url: string): AgencyWebListing | null {
  if (!html) return null
  const dominio = normalizeDomain(url)
  const texto = textoDelHtml(html)
  const title = meta(html, 'og:title') || primerElemento(html, 'h1') || primerElemento(html, 'title')

  const precioTexto =
    textoDeElementoCon(html, 'precio|price') ||
    meta(html, 'product:price:amount') ||
    texto.match(/(?:UF|CLP|US?\$|\$)\s*[\d.\s]+/i)?.[0] ||
    ''
  const { clp, uf, currency } = parsePrice(precioTexto)

  const bedrooms = campoJuntoA(texto, 'dormitorio|dorm\\.?|habitaci')
  const bathrooms = campoJuntoA(texto, 'ba(?:ñ|n)os?')
  const square_meters = parseSqm(
    texto.match(/superficie\s+(?:[uú]til|construida|interior|total)[^\d]*(\d[\d.,]*\s*m(?:2|²))/i)?.[1] || texto,
  )

  const seller_reference = parseInternalCode(texto, url) || parseInternalCode(title, url)
  if (!seller_reference && clp == null && uf == null) return null

  const fotos: Array<string | undefined> = []
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    fotos.push(m[0].match(/\bdata-src\s*=\s*["']([^"']+)["']/i)?.[1])
    fotos.push(m[0].match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1])
  }
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+\.(?:jpe?g|png|webp|avif)(?:\?[^"']*)?)["']/gi)) {
    fotos.push(m[1])
  }
  fotos.push(meta(html, 'og:image') ?? undefined)

  return {
    portal: `web:${dominio}`,
    source_type: 'agency_web',
    external_id: seller_reference ? `${dominio}:${seller_reference}` : `${dominio}:${hashUrl(url)}`,
    source_url: url,
    title,
    operation: parseOperation(title) || parseOperation(texto),
    property_type: parsePropertyType(title) || parsePropertyType(texto),
    price: clp,
    price_uf: uf,
    currency: currency || 'CLP',
    bedrooms,
    bathrooms,
    square_meters,
    comuna: comunaDe(texto),
    description: meta(html, 'og:description'),
    photos: cleanPhotos(fotos),
    seller_reference,
  }
}
