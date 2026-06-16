// ─────────────────────────────────────────────────────────────────────────────
// Parsers del HTML de Idealista (lista de resultados + ficha de detalle).
// Sin dependencias DOM: el HTML SSR de Idealista es estable y parseable con
// expresiones regulares acotadas por artículo/bloque.
// ─────────────────────────────────────────────────────────────────────────────

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
export function parseDetailPage(html, external_id) {
  const config = jsObject(html, 'config')
  const mm = jsObject(html, 'adMultimediasInfo')
  // Título → dirección + operación
  const titleM = html.match(/<title>([^<]*)<\/title>/)
  const title = titleM ? decode(titleM[1]).replace(/\s*—\s*idealista.*$/i, '') : null
  const operation = /alquiler/i.test(title ?? '') ? 'rent' : 'sale'

  // Precio
  const priceM = html.match(/info-data-price"><span class="txt-bold">([\d.]+)/) ||
                 html.match(/class="price">([\d.]+)/)
  const price = priceM ? toInt(priceM[1]) : null

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

  // Vídeos: del array `videos` del objeto JS + YouTube/Vimeo embebidos.
  const videoSet = new Set(), videos = []
  const videosArr = jsArray(mm, 'videos')
  if (videosArr) {
    for (const m of videosArr.matchAll(/"?(?:url|src|videoUrl)"?\s*:\s*"([^"]+)"/g)) {
      if (!videoSet.has(m[1])) { videoSet.add(m[1]); videos.push(m[1]) }
    }
  }
  for (const m of html.matchAll(/(?:youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/g)) {
    const u = `https://www.youtube.com/embed/${m[1]}`
    if (!videoSet.has(u)) { videoSet.add(u); videos.push(u) }
  }

  // Tours virtuales / 3D (visit3DTour, virtualTour360).
  const virtual_tours = []
  for (const key of ['visit3DTourURL', 'virtualTour360URL', 'visit3DTour', 'virtualTour360']) {
    const arr = jsArray(mm, key)
    if (arr) for (const m of arr.matchAll(/"(https?:\/\/[^"]+)"/g)) {
      if (!virtual_tours.includes(m[1])) virtual_tours.push(m[1])
    }
  }

  // ── Anunciante (particular vs profesional) desde `config` ───────────────────
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
    advertiser_name = profName || 'Profesional'
    advertiser_type = 'professional'
  } else if (firstName != null || /<span\s+class="particular"/.test(html)) {
    advertiser_name = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Particular'
    advertiser_type = 'particular'
  } else {
    // Respaldo al heurístico anterior.
    const advM = html.match(/class="professional-name"[^>]*>\s*<[^>]*>\s*([^<]+)/) ||
                 html.match(/class="advertiser-name">\s*([^<]+)/)
    advertiser_name = advM ? decode(advM[1]) : null
    advertiser_type = /professional/i.test(html) && advertiser_name ? 'professional'
      : /anunciante particular|particular/i.test(html) ? 'particular' : 'unknown'
  }

  // Teléfono del anunciante (visible en el SSR sin sesión cuando existe).
  const phoneM = html.match(/appcallback_target_phone="(\d{6,})"/) ||
                 html.match(/href="tel:(\+?\d{6,})"/)
  let phone = phoneM ? phoneM[1].replace(/^\+?34/, '') : null
  if (phone) phone = phone.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')

  // Referencia del anuncio.
  const refM = html.match(/class="txt-ref">\s*([A-Za-z0-9\-]+)\s*</)
  const reference = refM ? refM[1].trim() : external_id

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
  const stViews = html.match(/<strong>(\d+)<\/strong>\s*<span>\s*visitas/)
  const stEmail = html.match(/<strong>(\d+)<\/strong>\s*<span>\s*contactos por email/)
  const stFav = html.match(/<strong>(\d+)<\/strong>\s*<span>\s*veces guardado/)
  const stats = (stViews || stEmail || stFav) ? {
    views: stViews ? Number(stViews[1]) : null,
    email_contacts: stEmail ? Number(stEmail[1]) : null,
    favorites: stFav ? Number(stFav[1]) : null,
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

  // "Anuncio actualizado el DD de MONTH" → días en mercado
  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  let days_on_market = null
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
  }
}
