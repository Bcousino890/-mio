// ─────────────────────────────────────────────────────────────────────────────
// Parsers del HTML de Portalinmobiliario.com (vertical inmobiliario de
// Mercado Libre Chile). Espeja la forma de `lib/parse.mjs` (Idealista):
// `parseListPage(html)` / `parseDetailPage(html, externalId)`.
//
// Portalinmobiliario comparte el frontend "Andes" de Mercado Libre: en el
// listado, cada anuncio es un <li class="ui-search-layout__item"> con un
// título en <h2 class="poly-component__title">; la ficha de detalle usa URLs
// con patrón `MLC-\d+`. Fuente: docs/research-portalinmobiliario-chile.md.
//
// HIPÓTESIS NO VERIFICADA (a confirmar con un spike real de red, el sandbox
// de investigación bloqueó el fetch directo a portalinmobiliario.com): al ser
// presumiblemente una SPA tipo React/Next.js, es probable que la ficha (y/o
// el listado) incruste un blob JSON con el estado inicial — del tipo
// `__NEXT_DATA__`, `__PRELOADED_STATE__`, o el equivalente propio de ML
// ("ANDES" usa a veces `window.__PRELOADED_STATE__` en otras propiedades del
// grupo). Si existe, es preferible parsear ese JSON en vez del DOM renderizado
// (igual que con Idealista preferimos los objetos JS embebidos `config` /
// `adMultimediasInfo` sobre regex de HTML puro). Por eso intentamos extraerlo
// primero; si no aparece o no tiene la forma esperada, caemos a selectores
// DOM con regex, igual que el resto del scraper.
//
// Todas las funciones deben tolerar HTML inesperado: nunca lanzan, devuelven
// `[]`/`null` cuando no pueden extraer nada coherente.
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

// ─── Helper: extracción de blobs JSON embebidos tipo SPA ────────────────────
// Busca `<script>` con alguno de los nombres de variable global habituales en
// SPAs server-rendered. HIPÓTESIS NO VERIFICADA para este portal en concreto
// (ver cabecera del archivo) — implementado de forma defensiva: si no
// encuentra nada o el JSON no parsea, devuelve null sin lanzar.
const EMBEDDED_BLOB_PATTERNS = [
  /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  /window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i,
  /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i,
]

function extractEmbeddedJson(html) {
  if (!html) return null
  for (const re of EMBEDDED_BLOB_PATTERNS) {
    const m = html.match(re)
    if (!m) continue
    try {
      return JSON.parse(m[1])
    } catch {
      // Blob encontrado pero no parseable (truncado, JS no-JSON estricto…) —
      // seguimos probando otros patrones / caemos a DOM.
      continue
    }
  }
  return null
}

/**
 * Extrae los anuncios de una página de resultados de Portalinmobiliario.
 * Devuelve un array de { external_id, source_url, title, price, currency,
 *   bedrooms, square_meters, advertiser_name, advertiser_type } o `[]` si la
 * estructura no calza con lo esperado (nunca lanza).
 */
export function parseListPage(html) {
  try {
    if (!html) return []
    const out = []

    // Cada resultado: <li class="ui-search-layout__item" ...> ... </li>.
    // Troceamos por el marcador de apertura del item, igual que parse.mjs
    // trocea por <article para Idealista.
    const blocks = html.split(/<li[^>]+class="[^"]*ui-search-layout__item[^"]*"/).slice(1)
    for (const raw of blocks) {
      const block = raw

      // ID de ficha: patrón MLC-<dígitos> en cualquier href de la tarjeta.
      const idM = block.match(/MLC-?(\d+)/)
      if (!idM) continue
      const external_id = `MLC-${idM[1]}`

      const urlM = block.match(/href="(https?:\/\/[^"]*portalinmobiliario\.com[^"]*MLC-?\d+[^"]*)"/i)
      const source_url = urlM ? urlM[1] : `https://www.portalinmobiliario.com/MLC-${idM[1]}`

      const titleM = block.match(/poly-component__title[^>]*>([^<]+)</)
      const title = titleM ? decode(titleM[1]) : null

      // Precio: bloque típico de Andes es
      // <span class="andes-money-amount__fraction">123.456</span> con la
      // moneda en un span hermano ("$" = CLP, "UF" = unidad de fomento).
      const priceBlockM = block.match(/price[\s\S]{0,300}?andes-money-amount__fraction[^>]*>([\d.,]+)/i)
      const price = priceBlockM ? toInt(priceBlockM[1]) : null
      const currency = /\bUF\b/.test(block.slice(0, priceBlockM ? priceBlockM.index + 50 : 300)) ? 'UF' : 'CLP'

      // Atributos tipo "3 dormitorios", "80 m² tot." en
      // poly-component__attributes-item o similar.
      const attrs = [...block.matchAll(/poly-component__attributes-item[^>]*>([^<]+)</g)].map((m) => decode(m[1]))
      let bedrooms = null, square_meters = null
      for (const a of attrs) {
        if (/dormitorio|habitaci/i.test(a)) bedrooms = toInt(a)
        else if (/m²|m2/i.test(a)) square_meters = toInt(a)
      }

      // Anunciante: Portalinmobiliario casi siempre es agencia/corredora;
      // sin selector confirmado para particular vs profesional en el listado.
      const advertiser_name = null
      const advertiser_type = 'unknown'

      out.push({
        external_id,
        source_url,
        title, price, currency, bedrooms, square_meters,
        advertiser_name, advertiser_type,
      })
    }
    return out
  } catch {
    // Cualquier fallo inesperado de parseo: degradar a "sin resultados" en
    // vez de tumbar el scraper.
    return []
  }
}

/**
 * Parsea la ficha de detalle de Portalinmobiliario. Devuelve el objeto con
 * los mismos campos "core" que produce parseDetailPage de Idealista (en lo
 * que aplique a Chile) o `null` si no se pudo extraer nada coherente.
 *
 * Prioriza el blob JSON embebido (ver extractEmbeddedJson) si existe;
 * de lo contrario cae a selectores DOM con regex.
 */
export function parseDetailPage(html, external_id) {
  try {
    if (!html) return null

    const blob = extractEmbeddedJson(html)
    // Forma de `__NEXT_DATA__.props.pageProps` u homólogo: NO CONFIRMADA.
    // Tratamos el blob como bolsa de pistas best-effort, nunca como fuente
    // única obligatoria.
    const blobItem = blob?.props?.pageProps?.item ?? blob?.item ?? null

    const titleM = html.match(/<title>([^<]*)<\/title>/)
    const title = blobItem?.title ?? (titleM ? decode(titleM[1]).replace(/\s*[|-]\s*Portalinmobiliario.*$/i, '') : null)

    const operation = blobItem?.operation ??
      (/arriendo|arrendar/i.test(`${title ?? ''} ${html.slice(0, 2000)}`) ? 'rent' : 'sale')

    // Precio: preferimos el blob; fallback a regex sobre el bloque de precio
    // de Andes (mismo patrón que en el listado).
    let price = blobItem?.price?.amount ?? null
    let currency = blobItem?.price?.currency_id ?? null
    if (price == null) {
      const priceBlockM = html.match(/andes-money-amount__fraction[^>]*>([\d.,]+)/)
      price = priceBlockM ? toInt(priceBlockM[1]) : null
      currency = /\bUF\b/i.test(html.slice(0, priceBlockM ? priceBlockM.index + 50 : 0)) ? 'UF' : 'CLP'
    }
    currency = currency ?? 'CLP'

    // Coordenadas: el pin "declarado por el vendedor" — el dato a triangular
    // después, no a confiar ciegamente (ver research, sección de resolución
    // de identidad). Buscamos en el blob o en un mapa estático embebido.
    let latitude = blobItem?.location?.latitude ?? null
    let longitude = blobItem?.location?.longitude ?? null
    if (latitude == null || longitude == null) {
      const coordM = html.match(/"latitude"\s*:\s*(-?\d+\.\d+)[\s\S]{0,80}?"longitude"\s*:\s*(-?\d+\.\d+)/)
      if (coordM) {
        latitude = parseFloat(coordM[1])
        longitude = parseFloat(coordM[2])
      }
    }

    // Atributos estructurados (dormitorios, baños, m², tipo). Sin confirmar
    // contra HTML real; nombres de atributos siguiendo la convención ML
    // (BEDROOMS, FULL_BATHROOMS, COVERED_AREA) documentada en research.
    const attrs = [...html.matchAll(/poly-component__attributes-item[^>]*>([^<]+)</g)].map((m) => decode(m[1]))
    let bedrooms = blobItem?.attributes?.BEDROOMS ?? null
    let bathrooms = blobItem?.attributes?.FULL_BATHROOMS ?? null
    let square_meters = blobItem?.attributes?.COVERED_AREA ?? null
    for (const a of attrs) {
      if (bedrooms == null && /dormitorio|habitaci/i.test(a)) bedrooms = toInt(a)
      if (bathrooms == null && /baño/i.test(a)) bathrooms = toInt(a)
      if (square_meters == null && /m²|m2/i.test(a)) square_meters = toInt(a)
    }

    // Comuna/dirección: Portalinmobiliario usa "comuna" en vez de
    // barrio/distrito. Sin selector confirmado; intento best-effort sobre
    // breadcrumbs o bloque de ubicación típico de Andes.
    const addrM = html.match(/ui-pdp-media__title|ui-vip-location[^>]*>([^<]+)</)
    const address = blobItem?.location?.address_line ?? (addrM ? decode(addrM[1]) : null)
    const comunaM = html.match(/"comuna"\s*:\s*"([^"]+)"/i) || html.match(/breadcrumb[\s\S]{0,300}?>([^<,]+),\s*Región/i)
    const comuna = blobItem?.location?.city?.name ?? (comunaM ? decode(comunaM[1]) : null)

    // Fotos: el carrusel de Andes en ficha usa <img ... data-zoom="...">
    // o `srcset` con URLs http2.mlstatic.com. Sin confirmar.
    const photos = []
    const seenPhotos = new Set()
    for (const m of html.matchAll(/data-zoom="(https?:\/\/[^"]+\.(?:jpg|webp))"/g)) {
      if (!seenPhotos.has(m[1])) { seenPhotos.add(m[1]); photos.push(m[1]) }
    }
    if (photos.length === 0) {
      for (const m of html.matchAll(/(https?:\/\/http2\.mlstatic\.com\/[^\s"']+\.(?:jpg|webp))/g)) {
        if (!seenPhotos.has(m[1])) { seenPhotos.add(m[1]); photos.push(m[1]) }
      }
    }

    const advertiser_name = blobItem?.seller?.nickname ?? null
    const advertiser_id = blobItem?.seller?.id ?? null
    const advertiser_type = blobItem?.seller?.user_type === 'normal' ? 'particular' : (advertiser_name ? 'professional' : 'unknown')

    // Extracción de video: preferir blob, fallback a regex como en Idealista
    const videos = []
    const videoSet = new Set()

    // Buscar en arrays conocidos del blob
    if (blobItem) {
      for (const key of ['videos', 'video', 'videoList', 'media']) {
        const videosArr = blobItem[key]
        if (Array.isArray(videosArr)) {
          for (const v of videosArr) {
            const url = v?.url ?? v?.src ?? v?.videoUrl ?? v?.videoLocation ?? v
            if (typeof url === 'string' && /\.(?:mp4|webm|mov)|youtube|vimeo|mlstatic/i.test(url) && !videoSet.has(url)) {
              videoSet.add(url)
              videos.push(url)
            }
          }
        }
      }
    }

    // Fallback a regex: buscar URLs de video en el HTML/JSON
    if (videos.length === 0) {
      for (const m of html.matchAll(/"(?:videoUrl|video_url|url)":\s*"(https?:\/\/[^"]+\.(?:mp4|webm|mov)|(?:youtube|vimeo)[^"]*)"[\s\S]{0,200}?(?="video|")|(?=,)/g)) {
        const url = m[1]
        if (!videoSet.has(url)) { videoSet.add(url); videos.push(url) }
      }
      // Último intento: URLs mlstatic de video
      if (videos.length === 0) {
        for (const m of html.matchAll(/(https?:\/\/[^"']+mlstatic\.com\/[^\s"']*\.(?:mp4|webm|mov))/gi)) {
          const url = m[1]
          if (!videoSet.has(url)) { videoSet.add(url); videos.push(url) }
        }
      }
    }

    // Property code (referencia canónica que persiste en republicas): buscar en blob o HTML
    let property_code = blobItem?.id ?? blobItem?.property_id ?? blobItem?.propertyCode ?? null
    if (!property_code) {
      // Intento en HTML: puede estar en data-* o en JSON
      const propCodeM = html.match(/"(?:property[_-]?)?[iI]d"\s*:\s*(\d+)/) ||
                        html.match(/data-property-code="([^"]+)"/) ||
                        html.match(/"propertyCode"\s*:\s*"?(\d+)"?/)
      property_code = propCodeM ? propCodeM[1] : null
    }

    // Seller reference (referencia interna de la corredora)
    const seller_reference = blobItem?.seller?.reference ?? blobItem?.seller?.reference_id ?? null

    return {
      external_id,
      property_code,  // ID canónico de la propiedad (persiste en republicas)
      portal: 'portalinmobiliario',
      source_type: 'portal',
      source_url: `https://www.portalinmobiliario.com/${external_id}`,
      operation,
      title,
      price, currency,
      square_meters: square_meters != null ? toInt(square_meters) : null,
      bedrooms: bedrooms != null ? toInt(bedrooms) : null,
      bathrooms: bathrooms != null ? toInt(bathrooms) : null,
      latitude, longitude,
      address, comuna,
      advertiser_name, advertiser_type,
      advertiser_id,
      seller_reference,
      photos: photos.slice(0, 30),  // Cap a 30 fotos (antes era 40)
      videos: videos.length > 0 ? videos[0] : null,  // Primer video si existe
      description: blobItem?.description?.plain_text ?? null,
    }
  } catch {
    // Estructura inesperada de la ficha: degradar a `null`, igual que un
    // resultado de "no se pudo parsear", en vez de tumbar el scraper.
    return null
  }
}
