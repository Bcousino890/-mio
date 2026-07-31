// ─────────────────────────────────────────────────────────────────────────────
// crm-adapters/ofinet.mjs — adaptador para webs de corredoras sobre Ofinet
// (plan Anuncios CL · Fase 4 / H21).
// Verificado contra HTML real de cympropiedades.cl (julio 2026).
//
// Ofinet corre sobre ASP clásico (.asp), footer "Designed by Ofinet".
//
// CORRECCIONES sobre la versión anterior de este archivo, las tres comprobadas
// contra el sitio en vivo:
//
//   1) LISTADO. Apuntaba a i_listing-4-column.asp?select-status=…, que devuelve
//      24 bytes vacíos — esa vista está comentada en la plantilla. El listado
//      que sirve datos es i_listing.asp, y necesita el juego COMPLETO de
//      parámetros select-* (status, property-type, region, location, precio,
//      condominio, dormitorios, rbEs, idPro); con un subconjunto responde vacío.
//
//   2) SESIÓN. El filtro de búsqueda se guarda en la SESIÓN de ASP, no en la
//      URL. La paginación es "i_listing.asp?Order=ASC&NumPag=N" a secas: sin la
//      cookie ASPSESSIONID de la petición que fijó el filtro, la página 2
//      devuelve CERO fichas. Por eso el adaptador declara requiresSession y el
//      crawler mantiene un cookie jar por target.
//
//   3) FIN DEL LISTADO. El paginador es una VENTANA DESLIZANTE: en la página 1
//      solo se ven los enlaces 1-4; en la 4 aparecen hasta la 7, y así. Confiar
//      en "el número más alto del paginador" hacía creer que cympropiedades.cl
//      tenía 36 fichas en venta. Recorriendo NumPag hasta que una página viene
//      vacía son 759. El criterio de parada NO puede leerse del paginador: hay
//      que avanzar hasta la página vacía.
//
// FICHA: property.asp?idPro=<código>. El idPro ES el código interno que la
// corredora enseña como "Cód." en la ficha — el que engancha el enlace
// determinista de Nivel 1.5 contra el anuncio de Portal Inmobiliario.
// ─────────────────────────────────────────────────────────────────────────────
import { load } from 'cheerio'
import { clean, cleanPhotos, parsePropertyType, siteBase } from './index.mjs'
import { normalizeDomain } from '../detect-corredora-crm-cl.mjs'

export const platform = 'ofinet'

// El filtro vive en la sesión de ASP: el crawler debe reusar cookies entre la
// petición que fija el filtro y las de paginación (ver punto 2 de la cabecera).
export const requiresSession = true
// Fichas por página del listado verificado. Es orientativo: el criterio de
// parada real es la página vacía, no una cuenta.
export const pageSize = 9

// Códigos de estado de Ofinet en select-status.
const STATUS = { sale: 'VE', rent: 'AR' }

/**
 * URL del listado. La página 1 lleva el juego completo de filtros (es la que
 * fija la búsqueda en la sesión); de la 2 en adelante basta Order+NumPag, que
 * es exactamente lo que hacen los enlaces del paginador del sitio.
 *
 * Pedir una página >1 sin haber pedido antes la 1 en la MISMA sesión devuelve
 * cero fichas — no es un fallo del adaptador sino cómo funciona el sitio.
 */
export function listUrl(domain, { operation, page = 1, baseUrl } = {}) {
  const base = siteBase(domain, baseUrl)
  const n = Math.max(1, Number(page) || 1)
  if (n > 1) return `${base}/i_listing.asp?Order=ASC&NumPag=${n}`

  const params = new URLSearchParams({
    dormitorios: '0',
    'select-status': STATUS[operation] ?? 'VE',
    'select-property-type': '-1', // -1 = todos los tipos
    'select-region': '-1',        // -1 = todas las regiones
    'select-location': '-1',      // -1 = todas las comunas
    rbEs: '0',
    'min-price': '',
    'max-price': '',
    condominio: '2',              // 2 = indiferente
    idPro: '0',
  })
  return `${base}/i_listing.asp?${params.toString()}`
}

/** URL de la ficha. El idPro es el código interno de la corredora. */
export function detailUrl(domain, ref, { baseUrl } = {}) {
  return `${siteBase(domain, baseUrl)}/property.asp?idPro=${encodeURIComponent(ref)}`
}

/**
 * Enlaces a ficha de una página del listado.
 *
 * `total` y `lastPage` van siempre a null a propósito: Ofinet no publica el
 * total, y su paginador es una ventana deslizante que MIENTE sobre la última
 * página (ver cabecera). Devolver el máximo visible haría que el crawler parase
 * en la página 4 de 85. El criterio correcto —página sin fichas— lo aplica el
 * crawler sobre `items`.
 */
export function parseList(html, { domain = '', baseUrl } = {}) {
  if (!html) return { items: [], total: null, lastPage: null }

  const refs = new Set()
  for (const m of String(html).matchAll(/property\.asp\?idPro=(\d{1,9})/gi)) {
    // idPro=0 es el marcador de "sin propiedad" que el sitio usa en los enlaces
    // del menú de búsqueda; no es una ficha.
    if (m[1] !== '0') refs.add(m[1])
  }
  return {
    items: [...refs].map((ref) => ({ url: detailUrl(domain, ref, { baseUrl }), seller_reference: ref })),
    total: null,
    lastPage: null,
  }
}

// ─── Ficha ───────────────────────────────────────────────────────────────────

/**
 * Indexa el bloque de datos de la ficha (ul.amenities-detail), una lista de
 * <li><strong>Etiqueta:</strong> valor</li>. Igual que en Convecta se indexa por
 * etiqueta en vez de barrer texto plano: en el texto corrido de la página los
 * campos de la ficha quedan pegados a los de las propiedades relacionadas del
 * sidebar, y las regex sueltas acaban cogiendo las del vecino.
 */
function parseAmenityFields($) {
  const fields = new Map()
  $('.amenities-detail li, .pgl-detail li').each((_, el) => {
    const $li = $(el)
    const $strong = $li.find('strong').first()
    if ($strong.length) {
      const label = clean($strong.text()).replace(/[:.\s]+$/, '').toLowerCase()
      const value = clean($li.text().replace(clean($strong.text()), ''))
      if (label && value && !fields.has(label)) fields.set(label, value)
      return
    }
    // Dormitorios, baños y ubicación no llevan <strong>: se distinguen por el
    // icono (<i class="icons icon-bedroom"></i> 4 Dormitorios).
    const cls = $li.find('i.icons').attr('class') || ''
    const text = clean($li.text())
    if (/icon-bedroom/.test(cls) && !fields.has('dormitorios')) fields.set('dormitorios', text)
    else if (/icon-bathroom/.test(cls) && !fields.has('baños')) fields.set('baños', text)
    else if (/icon-location/.test(cls) && !fields.has('ubicacion')) fields.set('ubicacion', text)
  })
  return fields
}

function firstInt(text) {
  const m = clean(text).match(/(\d{1,3})/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** "207,63" | "2.750" → 208 | 2750. Punto = miles, coma = decimal. */
function parseM2(text) {
  const m = clean(text).match(/([\d.]+(?:,\d+)?)/)
  if (!m) return null
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/**
 * Precio y operación. Ofinet los pinta juntos, una vez por foto del carrusel:
 *   <span class="label price">UF 17.500,00</span>
 *   <span class="label forrent">Venta</span>
 * Se toma el PRIMERO: los del sidebar de propiedades relacionadas vienen
 * después en el documento y son de OTRAS fichas.
 */
function parsePriceAndOperation($) {
  const priceText = clean($('.label.price').first().text())
  const opText = clean($('.label.forrent').first().text())

  let priceUf = null
  let priceClp = null
  if (/uf/i.test(priceText)) {
    // "UF 17.500,00": punto = miles, coma = decimales (siempre ,00 en precios
    // de propiedad, se descartan).
    const m = priceText.match(/uf\s*([\d.]+)(?:,\d+)?/i)
    const n = m ? Number(m[1].replace(/\./g, '')) : NaN
    if (Number.isFinite(n) && n > 0) priceUf = n
  } else {
    const m = priceText.match(/\$\s*([\d.]+)/)
    const n = m ? Number(m[1].replace(/\./g, '')) : NaN
    if (Number.isFinite(n) && n > 0) priceClp = n
  }

  let operation = null
  if (/arriend|arrend/i.test(opText)) operation = 'rent'
  else if (/venta|vende/i.test(opText)) operation = 'sale'

  return { priceUf, priceClp, operation, opText }
}

/**
 * Ficha de Ofinet ya normalizada para upsertListingCl.
 *
 * @param {string} html
 * @param {{ url?: string, domain?: string, seller_reference?: string }} ctx
 */
export function parseDetail(html, { url = '', domain = '', seller_reference = null } = {}) {
  if (!html) return null
  const $ = load(html)
  const fields = parseAmenityFields($)

  const ref =
    clean(fields.get('cód') || fields.get('cod') || fields.get('código') || '').replace(/\D/g, '') ||
    String(url).match(/idPro=(\d{1,9})/i)?.[1] ||
    seller_reference
  if (!ref) return null

  const { priceUf, priceClp, operation, opText } = parsePriceAndOperation($)

  // "Sup.: 207,63m2/400m2" → construida / terreno.
  const [builtRaw, landRaw] = String(fields.get('sup') || fields.get('sup.') || '').split('/')
  const builtM2 = parseM2(builtRaw)
  const landM2 = parseM2(landRaw)

  // "Lo Barnechea, SANTIAGO" → comuna, región. La comuna es el primer tramo.
  const comuna = clean(String(fields.get('ubicacion') || '').split(',')[0]) || null

  // El h2 de la ficha es la dirección/referencia tal cual la escribe la
  // corredora ("MAYFLOWER/ LA LAGUNA"). Va primero: el og:title es el mismo
  // texto pero con la comuna y el nombre del sitio pegados detrás
  // ("… , Lo Barnechea - CyM Propiedades"), que no forman parte de la dirección.
  const title = clean($('.pgl-detail h2').first().text() || $('meta[property="og:title"]').attr('content'))
  const tipo = fields.get('tipo') || ''

  // Fotos. El carrusel usa la ruta relativa "Fotos/<idPro><letra>.jpg" y las
  // miniaturas "fotos/…" en minúscula: se absolutizan contra el origen del
  // sitio y se deduplican SIN distinguir mayúsculas, porque la misma foto
  // aparece con las dos grafías y si no se contaría dos veces.
  //
  // El filtro por <idPro> no es cosmético: la ficha lleva debajo un sidebar de
  // propiedades relacionadas con su propia foto cada una (fotos/4722a.jpg,
  // fotos/4606a.jpg…). Sin acotar al código de ESTA ficha, una propiedad de 17
  // fotos se guardaba con 40, y las de más eran de otras casas — que es
  // exactamente el material con el que el dedup por imagen decide si dos
  // anuncios son el mismo inmueble.
  const origin = (() => {
    try { return new URL(url).origin } catch { return siteBase(domain) }
  })()
  const mine = new RegExp(`fotos/${ref}[a-z]?\\.(?:jpe?g|png|webp)`, 'i')
  const raw = []
  $('img[src]').each((_, el) => raw.push($(el).attr('src')))
  raw.push($('meta[property="og:image"]').attr('content'))
  const seenLower = new Set()
  const photoUrls = []
  for (const src of raw.filter(Boolean)) {
    const s = clean(src)
    if (!mine.test(s)) continue
    const abs = /^https?:\/\//i.test(s) ? s : `${origin}/${s.replace(/^\.?\//, '')}`
    const key = abs.toLowerCase()
    if (seenLower.has(key)) continue
    seenLower.add(key)
    photoUrls.push(abs)
  }
  const photos = cleanPhotos(photoUrls)

  const features = []
  if (landM2) features.push(`Terreno: ${landM2} m²`)
  if (tipo) features.push(`Tipo: ${clean(tipo)}`)

  const video = clean($('iframe[src*="youtube" i]').attr('src')) || null
  const description =
    clean($('.pgl-detail p').first().text()) ||
    clean($('meta[property="og:description"]').attr('content')) ||
    null

  const contactos = clean($('.contacts-list').first().text())
  const d = normalizeDomain(domain) || normalizeDomain(url)

  return {
    portal: `web:${d}`,
    source_type: 'agency_web',
    external_id: `${d}:${ref}`,
    source_url: url || null,
    operation,
    // El tipo va en su propio campo ("Tipo: Casa"); el título es libre
    // ("MAYFLOWER/ LA LAGUNA") y no sirve para inferirlo. La etiqueta de
    // operación ("Venta - Casa") es el respaldo.
    property_type: parsePropertyType(tipo) || parsePropertyType(opText) || parsePropertyType(title),
    advertiser_type: 'professional',
    advertiser_name: clean($('.contacts-list .office').first().text()).replace(/^nombre\s*:\s*/i, '') || null,
    phone: contactos.match(/\+?56\s?\d[\d\s]{7,}/)?.[0]?.replace(/\s+/g, '') || null,
    price: priceClp,
    price_uf: priceUf,
    currency: priceUf != null ? 'UF' : 'CLP',
    bedrooms: firstInt(fields.get('dormitorios')),
    bathrooms: firstInt(fields.get('baños')),
    square_meters: builtM2,
    comuna,
    address: title || null,
    latitude: null,
    longitude: null,
    description,
    photos,
    photos_total_count: photos.length || null,
    features,
    has_video: Boolean(video),
    video_modal_url: video,
    property_code: null,
    advertiser_id: null,
    seller_reference: ref,
    crm_platform: platform,
  }
}
