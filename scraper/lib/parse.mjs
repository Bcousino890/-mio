// ─────────────────────────────────────────────────────────────────────────────
// Parsers del HTML de Idealista (lista de resultados + ficha de detalle).
// Sin dependencias DOM: el HTML SSR de Idealista es estable y parseable con
// expresiones regulares acotadas por artículo/bloque.
// ─────────────────────────────────────────────────────────────────────────────

import { detectCRMFromDetailPage } from './crm-detector.mjs'
import { calculatePhashFromUrl } from './phash.mjs'
import { cleanPhotos } from './watermark-removal.mjs'

const NAMED = {
  euro: '€', sup2: '²', sup3: '³', nbsp: ' ', amp: '&', quot: '"', apos: "'",
  lt: '<', gt: '>', ordf: 'ª', ordm: 'º', deg: '°', middot: '·', hellip: '…',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ',
  uuml: 'ü', Uuml: 'Ü', ndash: '–', mdash: '—', laquo: '«', raquo: '»',
}

const decode = (s) =>
  (s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED[name] ?? m)
    .replace(/\s+/g, ' ')
    .trim()

const toInt = (s) => {
  if (!s) return null
  const n = parseInt(String(s).replace(/[.\s]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Número total de resultados que el portal declara para esta búsqueda.
 * Sirve para saber si superamos el tope (~1.800) y hay que subdividir.
 */
export function parseTotalCount(html) {
  const m = html.match(/([\d.]+)\s+(?:casas|viviendas|inmuebles|anuncios)/i)
  return m ? toInt(m[1]) : null
}

/**
 * Extrae los anuncios de una página de resultados. Devuelve un array de
 * { external_id, source_url, title, price, bedrooms, square_meters, floor,
 *   advertiser_name, advertiser_type }.
 */
export function parseListPage(html) {
  const out = []
  // Cada anuncio es un <article ... class="item ...">. Troceamos por <article.
  const blocks = html.split(/<article\b/).slice(1)
  for (const raw of blocks) {
    const block = '<article' + raw

    const idM = block.match(/href="\/inmueble\/(\d+)\//)
    if (!idM) continue
    const external_id = idM[1]

    const linkM = block.match(/<a class="item-link[^"]*"[^>]*href="\/inmueble\/\d+\/"[^>]*>([^<]+)</)
    const title = linkM ? decode(linkM[1]) : null

    const priceM = block.match(/item-price[^>]*>([\d.]+)/)
    const price = priceM ? toInt(priceM[1]) : null

    // item-detail: "3 hab.", "149 m²", "3ª planta..."
    const details = [...block.matchAll(/item-detail[^>]*>([^<]+)</g)].map((m) => decode(m[1]))
    let bedrooms = null, square_meters = null, floor = null
    for (const d of details) {
      if (/hab\.?/i.test(d)) bedrooms = toInt(d)
      else if (/m²|m2/i.test(d)) square_meters = toInt(d)
      else if (/planta|bajo|entreplanta/i.test(d)) floor = d
    }

    // Anunciante: bloque con logo/nombre de agencia => profesional; si no, particular.
    const branding = block.match(/item-branding[\s\S]*?alt="([^"]*)"/) ||
                     block.match(/logo-branding[^>]*title="([^"]*)"/)
    const advertiser_name = branding ? decode(branding[1]) : null
    const advertiser_type = advertiser_name ? 'professional' : 'particular'

    out.push({
      external_id,
      source_url: `https://www.idealista.com/inmueble/${external_id}/`,
      title, price, bedrooms, square_meters, floor,
      advertiser_name, advertiser_type,
    })
  }
  return out
}

// ─── Helpers para leer los objetos JS embebidos de la ficha ─────────────────
// Idealista incrusta `var config = {…}` y `var adMultimediasInfo = {…}` en el
// HTML SSR (visibles sin sesión). Son la fuente más fiable: fotos, planos,
// vídeos, tours, anunciante, etc. Hacemos match de llaves/corchetes balanceado.
function matchBalanced(s, open, oc, cc) {
  let depth = 0, inStr = false, q = ''
  for (let i = open; i < s.length; i++) {
    const c = s[i], p = s[i - 1]
    if (inStr) { if (c === q && p !== '\\') inStr = false; continue }
    if (c === '"' || c === "'") { inStr = true; q = c; continue }
    if (c === oc) depth++
    else if (c === cc) { depth--; if (depth === 0) return s.slice(open, i + 1) }
  }
  return null
}
function jsObject(html, name) {
  const at = html.indexOf(`var ${name} = `)
  if (at === -1) return null
  const open = html.indexOf('{', at)
  return open === -1 ? null : matchBalanced(html, open, '{', '}')
}
function jsArray(objText, key) {
  if (!objText) return null
  const m = objText.match(new RegExp(`${key}\\s*:\\s*\\[`))
  if (!m) return null
  const open = objText.indexOf('[', m.index)
  return matchBalanced(objText, open, '[', ']')
}
// Saca las URLs grandes de un array de multimedias (imageDataService:"…jpg").
function imagesFrom(arrText) {
  if (!arrText) return []
  const seen = new Set(), out = []
  for (const m of arrText.matchAll(/imageDataService:"([^"]+\.jpg)"/g)) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]) }
  }
  return out
}
function tagsFrom(arrText) {
  if (!arrText) return []
  return [...arrText.matchAll(/tag:"([^"]*)"/g)].map((m) => decode(m[1]))
}

/**
 * Parsea la ficha de detalle. Devuelve el objeto completo del anuncio listo
 * para upsert en la tabla `listings`.
 */
export async function parseDetailPage(html, external_id) {
  const config = jsObject(html, 'config')
  const mm = jsObject(html, 'adMultimediasInfo')
  // Título → dirección + operación
  const titleM = html.match(/<title>([^<]*)<\/title>/)
  const title = titleM ? decode(titleM[1]).replace(/\s*—\s*idealista.*$/i, '') : null
  const cfgOperationM = config && config.match(/\boperation\s*:\s*'(rent|sale)'/)
  const operation = cfgOperationM ? cfgOperationM[1] : (/alquiler/i.test(title ?? '') ? 'rent' : 'sale')

  // Precio: preferimos config.idForm.buyingPrice (número exacto del JS
  // embebido). El texto renderizado ("info-data-price"/"price") cambia de
  // estructura entre venta y alquiler y puede acabar casando con otro número
  // de la página (anuncios similares, simulador de hipoteca…), lo que produce
  // precios absurdos.
  const cfgPriceM = config && config.match(/\bbuyingPrice\s*:\s*([\d.]+)/)
  const priceM = html.match(/info-data-price"><span class="txt-bold">([\d.]+)/) ||
                 html.match(/class="price">([\d.]+)/)
  const price = cfgPriceM ? Math.round(parseFloat(cfgPriceM[1])) : (priceM ? toInt(priceM[1]) : null)

  // Coordenadas desde la URL del staticmap: center=LAT%2CLNG
  let latitude = null, longitude = null
  const coordM = html.match(/center=(-?\d+\.\d+)%2C(-?\d+\.\d+)/)
  if (coordM) {
    latitude = parseFloat(coordM[1])
    longitude = parseFloat(coordM[2])
  }

  // Características (<li>) → m², habitaciones, baños + lista de features
  const features = [...html.matchAll(/<li>([^<]{2,80})<\/li>/g)]
    .map((m) => decode(m[1]))
    .filter((t) => t && !/^\s*$/.test(t))
  let square_meters = null, bedrooms = null, bathrooms = null
  for (const f of features) {
    if (square_meters == null && /m²|m2/i.test(f) && /constru/i.test(f)) square_meters = toInt(f)
    else if (square_meters == null && /m²|m2/i.test(f)) square_meters = toInt(f)
    if (bedrooms == null && /habitaci/i.test(f)) bedrooms = toInt(f)
    if (bathrooms == null && /baño/i.test(f)) bathrooms = toInt(f)
  }

  // ── Multimedia (preferimos el objeto JS embebido; regex como respaldo) ──────
  // adMultimediasInfo separa picturesWithoutPlans / plans / videos / tours.
  let photos = imagesFrom(jsArray(mm, 'picturesWithoutPlans'))
  let photo_tags = tagsFrom(jsArray(mm, 'picturesWithoutPlans'))
  let floor_plans = imagesFrom(jsArray(mm, 'plans'))

  if (photos.length === 0) {
    // Respaldo: deduplicar por id numérico del fichero del CDN.
    const byImageId = new Map(), byFloorPlanId = new Map()
    for (const m of html.matchAll(/https:\/\/img\d*\.idealista\.com\/blur\/[^\s"']+?\/(\d+)\.(?:jpg|webp)/g)) {
      const context = html.slice(Math.max(0, m.index - 300), m.index)
      const isFloorPlan = /plano|floor.?plan/i.test(context)
      const url = m[0].replace(/\/blur\/[^/]+\//, '/blur/WEB_DETAIL_TOP-L-L/').replace(/\.webp$/, '.jpg')
      const bucket = isFloorPlan ? byFloorPlanId : byImageId
      if (!bucket.has(m[1])) bucket.set(m[1], url)
    }
    photos = [...byImageId.values()].slice(0, 40)
    if (floor_plans.length === 0) floor_plans = [...byFloorPlanId.values()].slice(0, 5)
  }
  photos = photos.slice(0, 40)
  floor_plans = floor_plans.slice(0, 5)

  // Apply watermark removal for platform-specific image transformations
  // (Mobilia: .jpg → -original.jpg, Inmoweb: remove thumb suffixes, etc.)
  // Los planos vienen con la misma marca de agua WEB_DETAIL que las fotos.
  photos = cleanPhotos(photos, 'idealista')
  floor_plans = cleanPhotos(floor_plans, 'idealista')

  // Vídeos: del array `videos` del objeto JS + YouTube/Vimeo embebidos + iframes
  const videoSet = new Set(), videos = []

  // 1. Buscar en el objeto adMultimediasInfo.videos y variaciones
  for (const key of ['videos', 'professionalVideos', 'videoList']) {
    const videosArr = jsArray(mm, key)
    if (videosArr) {
      for (const m of videosArr.matchAll(/"?(?:url|src|videoUrl|videoLocation)"?\s*:\s*"([^"]+)"/g)) {
        if (!videoSet.has(m[1])) { videoSet.add(m[1]); videos.push(m[1]) }
      }
    }
  }

  // 2. Buscar URLs de vídeo en objetos de multimedia
  if (mm) {
    for (const m of mm.matchAll(/"(?:videoUrl|video_url|url)":\s*"(https?:\/\/[^"]+)"/g)) {
      if (!videoSet.has(m[1]) && /\.(?:mp4|webm|mov)|youtube|vimeo/i.test(m[1])) {
        videoSet.add(m[1])
        videos.push(m[1])
      }
    }
  }

  // 3. Buscar YouTube e Vimeo embebidos en iframes
  for (const m of html.matchAll(/(?:youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/g)) {
    const u = `https://www.youtube.com/embed/${m[1]}`
    if (!videoSet.has(u)) { videoSet.add(u); videos.push(u) }
  }
  for (const m of html.matchAll(/(?:vimeo\.com\/videos\/|player\.vimeo\.com\/video\/)(\d+)/g)) {
    const u = `https://player.vimeo.com/video/${m[1]}`
    if (!videoSet.has(u)) { videoSet.add(u); videos.push(u) }
  }

  // 4. Buscar iframes de vídeo con src directo (más permisivo)
  for (const m of html.matchAll(/<iframe[^>]+src="([^"]+)"/gi)) {
    const src = m[1]
    if (/(?:youtube|vimeo|video|mp4|idealista|media)/i.test(src) && !videoSet.has(src)) {
      videoSet.add(src)
      videos.push(src)
    }
  }

  // 5. Buscar <video> tags HTML5 con src
  for (const m of html.matchAll(/<video[^>]*>[\s\S]*?<source[^>]+src="([^"]+)"/gi)) {
    if (!videoSet.has(m[1])) { videoSet.add(m[1]); videos.push(m[1]) }
  }

  // 6. Buscar en atributos de data-* que Idealista usa para vídeos
  for (const m of html.matchAll(/data-(?:video|media)-(?:url|src)="([^"]+)"/gi)) {
    if (!videoSet.has(m[1])) { videoSet.add(m[1]); videos.push(m[1]) }
  }

  // 7. Buscar enlaces de vídeo en divs con clase video o media
  for (const m of html.matchAll(/class="[^"]*(?:video|media)[^"]*"[^>]*data-url="([^"]+)"/gi)) {
    if (!videoSet.has(m[1])) { videoSet.add(m[1]); videos.push(m[1]) }
  }

  // Tours virtuales / 3D (visit3DTour, virtualTour360).
  const virtual_tours = []
  for (const key of ['visit3DTourURL', 'virtualTour360URL', 'visit3DTour', 'virtualTour360', 'virtualTourUrl']) {
    const arr = jsArray(mm, key)
    if (arr) for (const m of arr.matchAll(/"(https?:\/\/[^"]+)"/g)) {
      if (!virtual_tours.includes(m[1])) virtual_tours.push(m[1])
    }
  }

  // Buscar iframes de tours 3D y enlaces de Matterport / otros proveedores
  for (const m of html.matchAll(/<iframe[^>]+src="([^"]*(?:matterport|3dtour|virtualTour|tour3d)[^"]*)"/gi)) {
    if (!virtual_tours.includes(m[1])) virtual_tours.push(m[1])
  }

  // Buscar URLs de tours 3D en atributos data-*
  for (const m of html.matchAll(/data-(?:tour|virtualTour)-url="([^"]+)"/gi)) {
    if (!virtual_tours.includes(m[1])) virtual_tours.push(m[1])
  }

  // ── Anunciante (particular vs profesional) desde `config` ───────────────────
  // Extrae el nombre completo del anunciante (agencia o particular).
  // Prioridad: config.adProfessionalName > config.adCommercialName > firstName+lastName > fallback HTML
  const cfg = (k) => {
    const m = config && config.match(new RegExp(`${k}\\s*:\\s*"([^"]*)"`))
    return m ? decode(m[1]) : null
  }
  const profName = cfg('adProfessionalName') || cfg('adCommercialName')
  const firstName = cfg('adFirstName')
  const lastName = cfg('adLastName')
  const isOffice = config ? /isOfficeContactType\s*:\s*true/.test(config) : false
  let advertiser_name, advertiser_type

  if (profName || isOffice) {
    // Profesional (agencia)
    advertiser_name = profName || 'Profesional'
    advertiser_type = 'professional'
  } else if (firstName != null || /<span\s+class="particular"/.test(html)) {
    // Particular
    advertiser_name = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Particular'
    advertiser_type = 'particular'
  } else {
    // Respaldo: buscar en HTML si config no tiene datos claros
    // Selectores CSS robustos para nombres de anunciantes:
    // - class="professional-name" (nombre de profesional)
    // - class="advertiser-name" (nombre genérico del anunciante)
    // - img[alt] en logo-branding (nombre de agencia)
    const advM = html.match(/class="professional-name"[^>]*>\s*<[^>]*>\s*([^<]+)/) ||
                 html.match(/class="advertiser-name">\s*([^<]+)/) ||
                 html.match(/class="logo-branding"[^>]*alt="([^"]*)"/)
    advertiser_name = advM ? decode(advM[1]) : null
    advertiser_type = /professional/i.test(html) && advertiser_name ? 'professional'
      : /anunciante particular|particular/i.test(html) ? 'particular' : 'unknown'
  }
  // TODO: Validar contra HTML real de Idealista para confirmar selectores CSS

  // Teléfono del anunciante: número de contacto completo y formateado.
  // Buscamos en varios lugares del HTML de Idealista (SSR sin sesión):
  // 1. Texto plano antes de span class="phone-type-info" (selector más robusto)
  // 2. Atributos data-* o appcallback_target_phone (alternativas)
  // 3. Enlaces href="tel:" (fallback final)
  // El número se normaliza y se formatea (ej: "666 12 34 56" para números de 9 dígitos)
  const phoneM = html.match(/(\d[\d\s.]{6,14}\d)\s*<span[^>]*class="phone-type-info/) ||
                 html.match(/appcallback_target_phone="(\d{6,})"/) ||
                 html.match(/data-phone="([^"]+)"/) ||
                 html.match(/href="tel:(\+?\d{6,})"/)
  let phone = phoneM ? phoneM[1].replace(/[^\d+]/g, '') : null

  // Normalizar: eliminar prefijo de España (+34 o 0034) si existe
  if (phone) {
    phone = phone.replace(/^\+?34/, '').replace(/^0/, '')
  }

  // Formatear a patrón español (XXX XX XX XX o similar)
  if (phone && phone.length === 9) {
    phone = phone.replace(/(\d{3})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4')
  } else if (phone && phone.length > 0) {
    // Para otros formatos, intentar formato genérico: XXX XXX XXX
    phone = phone.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')
  }
  // TODO: Validar contra HTML real de Idealista si los selectores CSS siguen siendo válidos

  // Referencia del anuncio: número/código único de referencia en Idealista.
  // Buscamos en varios selectores CSS estándar del portal:
  // 1. class="txt-ref" (más robusto, es la clase estándar de Idealista)
  // 2. class="ref-help" o divs con "Referencia del anuncio"
  // 3. Fallback al external_id si no encuentra nada
  let reference = external_id
  const refM = html.match(/class="txt-ref"[^>]*>\s*([A-Za-z0-9\-]+)\s*</)
  if (refM) {
    reference = refM[1].trim()
  } else {
    // Alternativa: buscar en <div> o <span> que contenga la ref (e.g., "W-0462UX")
    const altRefM = html.match(/(?:class="ref-help"[^>]*>[\s\S]*?<span[^>]*>|ref-help[^>]*>)\s*([A-Za-z0-9\-]+)/)
    if (altRefM) reference = altRefM[1].trim()
  }
  // TODO: Validar contra HTML real de Idealista si el patrón txt-ref sigue siendo estándar

  // ── Certificado energético (consumo + emisiones + imagen CEE) ───────────────
  const consM = html.match(/Consumo:\s*<\/span>\s*<span class="icon-energy-c-([a-g])"/i)
  const emisM = html.match(/Emisiones:\s*<\/span>\s*<span class="icon-energy-c-([a-g])"/i)
  const ceeImgM = html.match(/class="energy-certificate-img"\s+src="([^"]+)"/)
  const energy_cert = (consM || emisM || ceeImgM) ? {
    consumption: consM ? consM[1].toUpperCase() : null,
    emissions: emisM ? emisM[1].toUpperCase() : null,
    image: ceeImgM ? ceeImgM[1].replace(/\?.*$/, '') : null,
  } : null

  // Fianza (meses) y €/m² declarado por el portal.
  const depM = html.match(/Fianza de (\d+)\s*mes/i)
  const deposit_months = depM ? Number(depM[1]) : null
  const sqmPriceM = html.match(/Precio por m².*?([\d.,]+)\s*€\/m²/s)
  const price_sqm = sqmPriceM ? Math.round(parseFloat(sqmPriceM[1].replace('.', '').replace(',', '.'))) : null

  // Estadísticas del anuncio (visitas / contactos / favoritos).
  const stViews = html.match(/<strong>([\d.]+)<\/strong>\s*<span>\s*visitas/)
  const stEmail = html.match(/<strong>([\d.]+)<\/strong>\s*<span>\s*contactos por email/)
  const stFav = html.match(/<strong>([\d.]+)<\/strong>\s*<span>\s*veces guardado/)
  const stats = (stViews || stEmail || stFav) ? {
    views: stViews ? toInt(stViews[1]) : null,
    email_contacts: stEmail ? toInt(stEmail[1]) : null,
    favorites: stFav ? toInt(stFav[1]) : null,
  } : null

  // Descripción
  const descM = html.match(/class="adCommentsLanguage[^"]*"[^>]*>([\s\S]*?)<\/div>/)
  const description = descM ? decode(descM[1]).slice(0, 4000) : null

  // ── Dirección (cabecera de ubicación) + nivel de precisión ──────────────────
  const headerBlock = html.match(/id="headerMap"[\s\S]*?<\/ul>/)
  const addrLines = headerBlock
    ? [...headerBlock[0].matchAll(/class="header-map-list">\s*([^<]+?)\s*<\/li>/g)].map((m) => decode(m[1]))
    : []
  const titleMainM = html.match(/class="main-info__title-main"[^>]*>([^<]+)</)
  const streetLine = (addrLines[0] || (titleMainM ? decode(titleMainM[1]) : null) || '')
    .replace(/^(?:alquiler|venta)\s+de\s+\w+\s+en\s+/i, '')
    .trim() || null
  const isExact = /"addressVisibility":"EXACT"/.test(html)
  // Dirección legible completa (calle + barrio + distrito…).
  const address = addrLines.length ? addrLines.join(', ') : (streetLine || title || null)
  // Si el portal marca EXACT y la calle trae número, la consideramos exacta.
  const exact_address = isExact && streetLine && /\d/.test(streetLine) ? streetLine : null
  const barrio = addrLines.find((l) => /^Barrio /i.test(l))?.replace(/^Barrio\s+/i, '') ?? null
  const distrito = addrLines.find((l) => /^Distrito /i.test(l))?.replace(/^Distrito\s+/i, '') ?? null

  // Tipo de inmueble (de "Alquiler de piso en …" / "Venta de ático …")
  const typeM = (title ?? '').match(/(?:de|del)\s+(piso|ático|atico|estudio|dúplex|duplex|chalet|casa|local|garaje|loft|apartamento)/i)
  const property_type = typeM ? typeM[1].toLowerCase().replace('atico', 'ático').replace('duplex', 'dúplex') : 'piso'

  // "Anuncio actualizado el DD de MONTH" (fecha absoluta) o, el formato más
  // habitual en la ficha actual, "Anuncio actualizado hace N días/semanas/
  // meses/años" (fecha relativa) → días en mercado.
  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  let days_on_market = null
  if (/actualizado hoy/i.test(html)) {
    days_on_market = 0
  } else if (/actualizado ayer/i.test(html)) {
    days_on_market = 1
  } else {
    const relM = html.match(/actualizado hace\s+(\d+|un|una)\s*(día|días|semana|semanas|mes|meses|año|años)/i)
    if (relM) {
      const n = /^\d+$/.test(relM[1]) ? Number(relM[1]) : 1
      const unit = relM[2].toLowerCase()
      const mult = unit.startsWith('d') ? 1 : unit.startsWith('sem') ? 7 : unit.startsWith('mes') ? 30 : 365
      days_on_market = n * mult
    } else {
      const upM = html.match(/actualizado el (\d{1,2}) de ([a-záéí]+)(?:\s+de\s+(\d{4}))?/i)
      if (upM) {
        const day = Number(upM[1])
        const mon = MESES.indexOf(upM[2].toLowerCase())
        if (mon >= 0) {
          const now = new Date()
          const year = upM[3] ? Number(upM[3]) : (mon > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear())
          const d = new Date(Date.UTC(year, mon, day))
          days_on_market = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000))
        }
      }
    }
  }

  // Detectar CRM de la agencia (si existe enlace adicional).
  // El "enlace adicional" o "agency_url" es la URL de la ficha de la agencia en su CRM.
  // Buscamos en:
  // 1. div id="aditional-link" con <a href="..."> (selector CSS más robusto de Idealista)
  // 2. Enlaces con clase "additional-link" (variantes)
  // 3. Extractar automáticamente el CRM (Mobilia, Inmoweb, Level, etc.)
  const crmDetection = detectCRMFromDetailPage(html)
  // TODO: Validar que extractAdditionalLink en crm-detector captura todos los patrones de Idealista

  // ── Calcular pHash para fotos (en paralelo, sin descargar archivos) ────────
  // Limitar a max 3 fotos en paralelo para no saturar red
  let cover_phash = null
  let photo_phashes = []
  if (photos.length > 0) {
    try {
      const phashList = []
      for (let i = 0; i < photos.length; i += 3) {
        const batch = photos.slice(i, i + 3)
        const batchHashes = await Promise.all(
          batch.map(url => calculatePhashFromUrl(url, { timeout_ms: 8000, crop_border_px: 20 }))
        )
        phashList.push(...batchHashes)
      }
      photo_phashes = phashList.filter(h => h !== null)
      cover_phash = photo_phashes.length > 0 ? photo_phashes[0] : null
    } catch (e) {
      // Si falla el cálculo de pHash, continúa sin él (no bloquea el scraping)
      console.error(`  [phash] error calculando para ${external_id}: ${e.message}`)
    }
  }

  return {
    external_id,
    portal: 'idealista',
    source_type: 'portal',
    source_url: `https://www.idealista.com/inmueble/${external_id}/`,
    operation,
    title, price, price_sqm, square_meters, bedrooms, bathrooms,
    property_type,
    latitude, longitude,
    blur_radius_m: 180,
    address, exact_address, barrio, distrito,
    days_on_market,
    advertiser_name, advertiser_type,
    phone, reference,
    energy_cert, deposit_months, stats,
    description,
    features,
    photos, photo_tags,
    floor_plans,
    videos, virtual_tours,
    cover_phash,
    photo_phashes,
    // Información de CRM detectado
    agency_url: crmDetection?.agencyUrl ?? null,
    agency_crm: crmDetection?.crm ?? null,
    agency_reference_id: crmDetection?.referenceId ?? null,
    agency_domain: crmDetection?.agencyDomain ?? null,
  }
}
