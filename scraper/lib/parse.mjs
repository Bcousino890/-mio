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

/**
 * Parsea la ficha de detalle. Devuelve el objeto completo del anuncio listo
 * para upsert en la tabla `listings`.
 */
export function parseDetailPage(html, external_id) {
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

  // Fotos (CDN de Idealista, normalizadas a un perfil grande seguro).
  // El CDN sirve cada imagen en .jpg y .webp; deduplicamos por el id numérico
  // del fichero y nos quedamos con una sola URL (.jpg) por foto.
  const byImageId = new Map()
  for (const m of html.matchAll(/https:\/\/img\d*\.idealista\.com\/blur\/[^\s"']+?\/(\d+)\.(?:jpg|webp)/g)) {
    const url = m[0].replace(/\/blur\/[^/]+\//, '/blur/WEB_DETAIL_TOP-L-L/').replace(/\.webp$/, '.jpg')
    if (!byImageId.has(m[1])) byImageId.set(m[1], url)
  }
  const photos = [...byImageId.values()].slice(0, 40)

  // Anunciante
  const advM = html.match(/class="professional-name"[^>]*>\s*<[^>]*>\s*([^<]+)/) ||
               html.match(/class="advertiser-name">\s*([^<]+)/)
  const advertiser_name = advM ? decode(advM[1]) : null
  const advertiser_type = /professional/i.test(html) && advertiser_name ? 'professional'
    : /anunciante particular|particular/i.test(html) ? 'particular' : 'unknown'

  // Descripción
  const descM = html.match(/class="adCommentsLanguage[^"]*"[^>]*>([\s\S]*?)<\/div>/)
  const description = descM ? decode(descM[1]).slice(0, 4000) : null

  // Dirección legible (de la cabecera de ubicación)
  const addrM = html.match(/class="main-info__title-minor"[^>]*>([^<]+)</) ||
                html.match(/id="headerMap"[\s\S]{0,200}?<li[^>]*>([^<]+)</)
  const address = addrM ? decode(addrM[1]) : (title ?? null)

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
    title, price, square_meters, bedrooms, bathrooms,
    property_type,
    latitude, longitude,
    blur_radius_m: 180,
    address,
    days_on_market,
    advertiser_name, advertiser_type,
    description,
    features,
    photos,
  }
}
