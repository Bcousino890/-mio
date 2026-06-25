// parse-portalinmobiliario-cl.ts — Duplicado (TS) de
// `scraper/lib/parse-portalinmobiliario.mjs` (solo `parseDetailPage`). Mismo
// motivo que `web/lib/geocode-cl.ts`: web/ y scraper/ son proyectos Node
// separados y el build Docker de web/ no incluye scraper/lib.
//
// Portalinmobiliario comparte el frontend "Andes" de Mercado Libre: la ficha
// de detalle incrusta el estado inicial en
// `<script id="__NORDIC_RENDERING_CTX__">_n.ctx.r={...}</script>`, con el JSON
// real en `blob.appProps.pageProps.initialState`. Ver el .mjs original para el
// detalle completo de la estructura (confirmado con 11 fichas reales).

const NAMED: Record<string, string> = {
  euro: '€', sup2: '²', sup3: '³', nbsp: ' ', amp: '&', quot: '"', apos: "'",
  lt: '<', gt: '>', ordf: 'ª', ordm: 'º', deg: '°', middot: '·', hellip: '…',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ',
  uuml: 'ü', Uuml: 'Ü', ndash: '–', mdash: '—', laquo: '«', raquo: '»',
}

const decode = (s: string | null | undefined) =>
  (s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED[name] ?? m)
    .replace(/\s+/g, ' ')
    .trim()

const toInt = (s: unknown): number | null => {
  if (!s) return null
  const n = parseInt(String(s).replace(/[.\s]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

// El blob puede contener strings con `{`/`}` (descripciones, JSON escapado),
// así que se balancea por profundidad de llaves en vez de usar un regex
// no-greedy que puede truncar antes del cierre real.
function extractNordicBlob(html: string): any {
  if (!html) return null
  const marker = html.match(/<script[^>]*id=["']__NORDIC_RENDERING_CTX__["'][^>]*>_n\.ctx\.r=/)
  if (!marker || marker.index == null) return null

  const start = marker.index + marker[0].length
  let depth = 0, inStr = false, esc = false, begin = -1
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (begin === -1) {
      if (c === '{') { begin = i; depth = 1 }
      continue
    }
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(begin, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function extractInitialState(html: string): any {
  const blob = extractNordicBlob(html)
  return blob?.appProps?.pageProps?.initialState ?? null
}

export interface ParsedListingDetail {
  portal: 'portalinmobiliario'
  operation: 'rent' | 'sale' | null
  property_type: string | null
  title: string | null
  price: number | null
  currency: string | null
  square_meters: number | null
  bedrooms: number | null
  bathrooms: number | null
  latitude: number | null
  longitude: number | null
  address: string | null
  comuna: string | null
  advertiser_name: string | null
  advertiser_type: string
  photos: string[]
  description: string | null
}

/**
 * Parsea la ficha de detalle de Portalinmobiliario. Prioriza el blob "Nordic"
 * embebido; si no existe o no calza con lo esperado, degrada a selectores DOM
 * con regex. Nunca lanza — devuelve `null` si no se pudo extraer nada
 * coherente.
 */
export function parsePortalListingDetail(html: string): ParsedListingDetail | null {
  try {
    if (!html) return null

    const state = extractInitialState(html)
    const comps = state?.components ?? {}
    const eventData = state?.track?.melidata_event?.event_data ?? null
    const sellerProfile = comps.seller_profile ?? comps.seller_profile_rex ?? comps.fixed?.seller_profile ?? comps.fixed?.seller_profile_rex ?? null
    const mapInfo = comps.location_and_points?.map_info ?? null

    const titleM = html.match(/<title>([^<]*)<\/title>/)
    const title = comps.header?.title ?? (titleM ? decode(titleM[1]).replace(/\s*[|-]\s*Portalinmobiliario.*$/i, '') : null)

    const domainId = eventData?.domain_id ?? ''
    const operation: 'rent' | 'sale' | null = /FOR_RENT/i.test(domainId) ? 'rent'
      : /FOR_SALE/i.test(domainId) ? 'sale'
      : (/arriendo|arrendar/i.test(`${title ?? ''} ${html.slice(0, 2000)}`) ? 'rent' : 'sale')
    const property_type = /APARTMENT/i.test(domainId) ? 'departamento'
      : /HOUSE/i.test(domainId) ? 'casa'
      : null

    let price: number | null = eventData?.price ?? null
    let currency: string | null = eventData?.currency_id === 'CLF' ? 'UF' : (eventData?.currency_id ?? null)
    if (price == null) {
      const priceBlockM = html.match(/andes-money-amount__fraction[^>]*>([\d.,]+)/)
      price = priceBlockM ? toInt(priceBlockM[1]) : null
      currency = /\bUF\b/i.test(html.slice(0, priceBlockM ? priceBlockM.index! + 50 : 0)) ? 'UF' : 'CLP'
    }
    currency = currency ?? 'CLP'

    // Try multiple locations where coordinates might be stored
    let latitude: number | null = null
    let longitude: number | null = null

    // Try 1: location_and_points.map_info.location
    let loc = mapInfo?.location ?? null
    if (loc?.latitude) latitude = parseFloat(loc.latitude)
    if (loc?.longitude) longitude = parseFloat(loc.longitude)

    // Try 2: location_and_points directly (sometimes lat/lng are here)
    if (latitude == null && comps.location_and_points?.lat)
      latitude = parseFloat(comps.location_and_points.lat)
    if (longitude == null && comps.location_and_points?.lng)
      longitude = parseFloat(comps.location_and_points.lng)

    // Try 3: Search in the entire state object (last resort)
    if (latitude == null || longitude == null) {
      const findCoords = (obj: any): {lat?: string, lng?: string} | null => {
        if (!obj || typeof obj !== 'object') return null
        if (obj.lat && obj.lng) return {lat: obj.lat, lng: obj.lng}
        for (const key of Object.keys(obj)) {
          const result = findCoords(obj[key])
          if (result) return result
        }
        return null
      }
      const coordsObj = findCoords(state)
      if (coordsObj) {
        if (latitude == null && coordsObj.lat) latitude = parseFloat(coordsObj.lat)
        if (longitude == null && coordsObj.lng) longitude = parseFloat(coordsObj.lng)
      }
    }

    let bedrooms: number | null = null, bathrooms: number | null = null, square_meters: number | null = null
    const specAttrs = comps.highlighted_specs_res?.attributes ?? comps.fixed?.highlighted_specs_res?.attributes ?? []
    for (const a of specAttrs) {
      const iconId = a?.icon?.id
      const text = a?.label?.text
      if (!text) continue
      if (iconId === 'BED') bedrooms = toInt(text)
      else if (iconId === 'BATHROOM') bathrooms = toInt(text)
      else if (iconId === 'SCALE_UP') square_meters = toInt(text)
    }

    const itemLocation = mapInfo?.item_location ?? null
    const comuna = eventData?.city || (itemLocation ? itemLocation.split(',')[0].trim() : null) || null
    const itemAddress = mapInfo?.item_address?.trim()
    const headerAddress = comps.header?.link_label?.label?.text?.replace(/^,\s*/, '').trim()
    const address = itemAddress || headerAddress || null

    const gallery = comps.gallery_mosaic ?? comps.fixed?.gallery_mosaic ?? null
    const photos: string[] = []
    const seenPhotos = new Set<string>()
    const addPhoto = (url?: string | null) => { if (url && !seenPhotos.has(url)) { seenPhotos.add(url); photos.push(url) } }
    if (gallery?.primary?.src) addPhoto(gallery.primary.src)
    for (const p of gallery?.secondary ?? []) addPhoto(p?.src)
    if (photos.length === 0) {
      for (const m of html.matchAll(/data-zoom="(https?:\/\/[^"]+\.(?:jpg|webp))"/g)) addPhoto(m[1])
      if (photos.length === 0) {
        for (const m of html.matchAll(/(https?:\/\/http2\.mlstatic\.com\/[^\s"']+\.(?:jpg|webp))/g)) addPhoto(m[1])
      }
    }

    const advertiser_name = sellerProfile?.seller_name?.title?.text ?? null
    const sellerType = eventData?.seller_type ?? null
    const advertiser_type = sellerType
      ? (sellerType === 'real_estate_agency' ? 'professional' : 'particular')
      : (advertiser_name ? 'professional' : 'unknown')

    const description = comps.description?.content ?? comps.description_rex?.content ?? null

    return {
      portal: 'portalinmobiliario',
      operation,
      property_type,
      title,
      price, currency,
      square_meters,
      bedrooms,
      bathrooms,
      latitude, longitude,
      address, comuna,
      advertiser_name, advertiser_type,
      photos: photos.slice(0, 30),
      description,
    }
  } catch {
    return null
  }
}
