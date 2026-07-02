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
  // Ficha técnica completa (V4) — claves para identificar la propiedad exacta
  sqm_terreno: number | null      // superficie total / de terreno
  sqm_construida: number | null   // superficie construida / útil
  floors: number | null           // cantidad de pisos
  year_built: number | null       // año de construcción (o derivado de antigüedad)
  orientation: string | null      // norte / surponiente / ...
  parking: number | null
  storage: number | null          // bodegas
  has_pool: boolean
  is_condo: boolean
}

// ─── Ficha técnica (V4) ──────────────────────────────────────────────────────
// Las specs se extraen del HTML renderizado (SSR) + título + descripción con
// regex, en vez de navegar la estructura del blob: la tabla de specs cambia de
// componente según el tipo de ficha, pero el texto visible es estable.

function toNum(s: string | undefined | null): number | null {
  if (!s) return null
  const n = parseInt(s.replace(/[.\s]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

export function extractTechSpecs(html: string, title: string | null, description: string | null) {
  // Se busca sobre texto plano (sin tags) para que los valores separados por
  // markup ("<th>Superficie total</th><td>4.022 m²</td>") queden adyacentes.
  const text = `${title ?? ''}\n${html.replace(/<[^>]+>/g, ' ')}\n${description ?? ''}`
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')

  const m = (re: RegExp) => text.match(re)?.[1] ?? null

  let sqm_terreno = toNum(m(/superficie (?:total|de terreno|terreno)\s*:?\s*([\d.]+)\s*m/i))
  let sqm_construida = toNum(m(/superficie (?:construida|útil|util)\s*:?\s*([\d.]+)\s*m/i))

  // Patrón de título muy común en casas: "4.022/258 Mt2" = terreno/construida
  const dual = (title ?? '').match(/([\d.]{3,7})\s*\/\s*([\d.]{2,6})\s*(?:m|mt)2?/i)
  if (dual) {
    const a = toNum(dual[1])
    const b = toNum(dual[2])
    if (a && b) {
      sqm_terreno = sqm_terreno ?? Math.max(a, b)
      sqm_construida = sqm_construida ?? Math.min(a, b)
    }
  }

  const floors = toNum(m(/cantidad de pisos\s*:?\s*(\d+)/i)) ?? toNum(m(/\b(\d)\s*pisos\b/i))

  let year_built = toNum(m(/año de construcci[oó]n\s*:?\s*(\d{4})/i))
  if (!year_built) {
    const antiguedad = toNum(m(/antig[üu]edad\s*:?\s*(\d{1,3})\s*años?/i))
    if (antiguedad != null) year_built = new Date().getFullYear() - antiguedad
  }

  const orientation = m(/orientaci[oó]n\s*:?\s*(nor(?:te|oriente|poniente)|sur(?:oriente|poniente)?|oriente|poniente|noreste|noroeste|sureste|suroeste)/i)

  const parking = toNum(m(/estacionamientos?\s*:?\s*(\d{1,2})/i))
  const storage = toNum(m(/bodegas?\s*:?\s*(\d{1,2})/i))

  const has_pool = /piscina\s*:?\s*(sí|si\b|1)/i.test(text) || /\bpiscina\b/i.test(`${title ?? ''} ${description ?? ''}`)
  const is_condo = /\bcondominio\b|\bcond\.?\b/i.test(`${title ?? ''} ${description ?? ''}`)

  return { sqm_terreno, sqm_construida, floors, year_built, orientation: orientation ? orientation.toLowerCase() : null, parking, storage, has_pool, is_condo }
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

    const loc = mapInfo?.location ?? null
    const latitude = loc?.latitude != null ? parseFloat(loc.latitude) : null
    const longitude = loc?.longitude != null ? parseFloat(loc.longitude) : null

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

    const specs = extractTechSpecs(html, title, description)
    // El "m²" destacado suele ser la superficie total; si la ficha técnica
    // trae terreno/construida por separado, esos valores son la verdad.
    if (specs.sqm_terreno == null && square_meters != null && specs.sqm_construida != null && square_meters > specs.sqm_construida) {
      specs.sqm_terreno = square_meters
    }

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
      ...specs,
    }
  } catch {
    return null
  }
}
