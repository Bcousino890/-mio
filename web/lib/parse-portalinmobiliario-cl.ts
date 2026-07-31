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

// Superficie en m² con formato chileno ("232,33 m²" = 232; "23.056 m²" = 23056):
// el punto es separador de miles y la coma decimal, así que se descartan los
// decimales y se quitan los puntos antes de parsear.
const toSqm = (s: unknown): number | null => {
  if (!s) return null
  const m = String(s).match(/[\d.,]+/)
  if (!m) return null
  const n = parseInt(m[0].split(',')[0].replace(/\./g, ''), 10)
  return Number.isFinite(n) ? n : null
}

// Id ESTABLE de una foto de Mercado Libre, para deduplicar la MISMA imagen que
// llega con plantillas de URL distintas (mosaico `D_NQ_NP_2X_<id>-F.webp` vs
// modal `D_NQ_NP_<id>-O.webp` vs `srcset`). Deduplicar por URL completa las
// contaba como fotos distintas e inflaba el total ("21 fotos" cuando eran 16).
// Devuelve la URL tal cual si no reconoce un id de ML (logos/avatares, etc.).
export function photoIdKey(url: string): string {
  const m = url.match(/\d+-MLC\d+/)
  return m ? m[0] : url
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
  advertiser_id: string | null
  advertiser_logo: string | null
  // Código canónico de la propiedad en Mercado Libre (persiste entre
  // re-publicaciones, ver docs/PLAN-ANUNCIOS-CL.md) y código interno de la
  // corredora — las dos claves que usa el dedup (Nivel 1) para agrupar
  // anuncios de la misma corredora bajo una sola ficha.
  property_code: string | null
  seller_reference: string | null
  has_video: boolean
  video_modal_url: string | null
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
  // URL del modal con la galería completa (Fase 2: requiere fetch adicional)
  gallery_url?: string | null
  photos_total_count?: number | null
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

  // Superficies TIPADAS y separadas: "Superficie total" en una casa es la
  // CONSTRUIDA (todas las plantas), NO el terreno. Confundir "total" con terreno
  // (bug anterior) hacía que square_meters mostrara la parcela ("23056 m²") en
  // vez de la construida ("232 m²"). El terreno solo sale de "de/del terreno".
  const sqm_total = toSqm(m(/superficie total\s*:?\s*([\d.,]+)\s*m/i))
  const sqm_util = toSqm(m(/superficie [úu]til\s*:?\s*([\d.,]+)\s*m/i))
  const sqm_construida_raw = toSqm(m(/superficie (?:construida|edificada)\s*:?\s*([\d.,]+)\s*m/i))
  let sqm_terreno = toSqm(m(/superficie (?:del?\s+)?terreno\s*:?\s*([\d.,]+)\s*m/i))
  let sqm_construida = sqm_construida_raw ?? sqm_total ?? sqm_util

  // Patrón de título muy común en casas: "4.022/258 Mt2" = terreno/construida
  const dual = (title ?? '').match(/([\d.]{3,7})\s*\/\s*([\d.]{2,6})\s*(?:m|mt)2?/i)
  if (dual) {
    const a = toSqm(dual[1])
    const b = toSqm(dual[2])
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

    let bedrooms: number | null = null, bathrooms: number | null = null
    let sqmHighlightedBuilt: number | null = null, sqmHighlightedTerreno: number | null = null
    const specAttrs = comps.highlighted_specs_res?.attributes ?? comps.fixed?.highlighted_specs_res?.attributes ?? []
    for (const a of specAttrs) {
      const iconId = a?.icon?.id
      const text = a?.label?.text
      if (!text) continue
      if (iconId === 'BED') bedrooms = toInt(text)
      else if (iconId === 'BATHROOM') bathrooms = toInt(text)
      else if (iconId === 'SCALE_UP') {
        // La ficha puede traer DOS specs de m² (construida/total + terreno). El
        // terreno de una parcela (miles de m²) NO es la superficie del inmueble:
        // separarlo para que no pise el valor construido.
        if (/terreno|lote|parcela|predio|sitio/i.test(text)) sqmHighlightedTerreno = toSqm(text)
        else sqmHighlightedBuilt = toSqm(text)
      }
    }

    const itemLocation = mapInfo?.item_location ?? null
    const comuna = eventData?.city || (itemLocation ? itemLocation.split(',')[0].trim() : null) || null
    const itemAddress = mapInfo?.item_address?.trim()
    const headerAddress = comps.header?.link_label?.label?.text?.replace(/^,\s*/, '').trim()
    const address = itemAddress || headerAddress || null

    // TODAS las fotos del anuncio, no solo el mosaico de portada:
    // gallery_mosaic trae ~5 imágenes; el carrusel completo (20-40 fotos)
    // aparece repetido por el blob/HTML en variantes de tamaño de la misma
    // imagen (D_NQ_NP_2X_<id>-O.webp, D_NQ_NP_<id>-F.webp, ...). Se dedupe
    // por el <id> y se prefiere la variante más grande.
    const photoById = new Map<string, { url: string; rank: number }>()
    const photoOrder: string[] = []
    const addPhoto = (url?: string | null) => {
      if (!url) return
      // id estable de la imagen: lo que queda al quitar prefijos de tamaño y
      // el sufijo de variante (-O/-F/-V/-R...) — ej. "601011-MLC69497908626_052023"
      const m = url.match(/\/D_(?:NQ_NP_)?(?:2X_)?([\w.-]+?)(?:-[A-Z])?\.(?:jpg|jpeg|webp)/i)
      const id = m ? m[1] : url
      // logos/avatares de vendedor no siguen el patrón D_ — fuera
      if (!m && !/mlstatic\.com\/D_/i.test(url)) return
      const rank = (url.includes('2X_') ? 2 : 0) + (/-[FO]\.(?:jpg|jpeg|webp)/i.test(url) ? 1 : 0)
      const existing = photoById.get(id)
      if (!existing) {
        photoById.set(id, { url, rank })
        photoOrder.push(id)
      } else if (rank > existing.rank) {
        photoById.set(id, { url, rank })
      }
    }
    const gallery = comps.gallery_mosaic ?? comps.fixed?.gallery_mosaic ?? null
    if (gallery?.primary?.src) addPhoto(gallery.primary.src)
    for (const p of gallery?.secondary ?? []) addPhoto(p?.src)
    for (const m of html.matchAll(/data-zoom="(https?:\/\/[^"]+\.(?:jpg|jpeg|webp))"/gi)) addPhoto(m[1])
    for (const m of html.matchAll(/(https?:\/\/http2\.mlstatic\.com\/[^\s"'\\)]+\.(?:jpg|jpeg|webp))/gi)) addPhoto(m[1])
    const photos: string[] = photoOrder.map((id) => photoById.get(id)!.url)

    const advertiser_name = sellerProfile?.seller_name?.title?.text ?? null
    const sellerType = eventData?.seller_type ?? null
    const advertiser_type = sellerType
      ? (sellerType === 'real_estate_agency' ? 'professional' : 'particular')
      : (advertiser_name ? 'professional' : 'unknown')

    // advertiser_id = seller_id de Mercado Libre (id ESTABLE de la corredora,
    // clave de identidad de corredoras_cl y del dedup por código interno).
    // Mismos 3 fallbacks que el parser del barrido masivo (scraper/lib/
    // parse-portalinmobiliario.mjs): blob → dataLayer de GTM → logo de tienda.
    const SELLER_LOGO_RE = /https:\/\/[\w.-]*mlstatic\.com\/(?:classifieds_accounts\/MLC_real_estate_agency|storage\/vis-accounts)\/(\d+)_vip[-_][^"'\\\s>]*/
    const logoMatch = html.match(SELLER_LOGO_RE)
    let advertiser_id: string | null = eventData?.seller_id != null ? String(eventData.seller_id) : null
    if (!advertiser_id) {
      const gtm = html.match(/"sellerId"\s*:\s*(\d+)/)
      if (gtm) advertiser_id = gtm[1]
    }
    if (!advertiser_id && logoMatch) advertiser_id = logoMatch[1]
    const advertiser_logo = logoMatch ? logoMatch[0] : null

    // Código de propiedad ML (persiste entre re-publicaciones): bloque
    // `seller_profile(.rex)?.bottom_extra_info[]` con título "Código de la
    // propiedad" → subtitles[0].text.
    let property_code: string | null = null
    for (const item of sellerProfile?.bottom_extra_info ?? []) {
      if (/c[oó]digo de la propiedad/i.test(item?.title?.text ?? '')) {
        property_code = item?.subtitles?.[0]?.text ?? null
        break
      }
    }

    // Código interno de la corredora: componente `code_internal`, label
    // "Código interno <ref>" — mutuamente excluyente con property_code en la
    // muestra real (nunca aparecen ambos en la misma ficha).
    const codeInternalLabel = comps.code_internal?.label?.text ?? comps.fixed?.code_internal?.label?.text ?? null
    const seller_reference = codeInternalLabel
      ? codeInternalLabel.replace(/^c[oó]digo interno\s*/i, '').trim() || null
      : null

    const description = comps.description?.content ?? comps.description_rex?.content ?? null

    // URL del modal con la galería completa, total de fotos y video: el
    // archivo real del video nunca aparece como URL directa en el HTML
    // estático, solo el booleano y la URL de este modal.
    const galleryMediaCounters = gallery?.media_counters ?? []
    const galleryUrl = galleryMediaCounters.find((m: any) => m?.type === 'photos')?.url ?? null
    const photosTotalCount = gallery?.total_count ?? (photos.length || null)
    const has_video: boolean = gallery?.has_video ?? false
    const video_modal_url = galleryMediaCounters.find((m: any) => m?.type === 'video')?.url ?? null

    const specs = extractTechSpecs(html, title, description)
    // Superficie del inmueble = superficie CONSTRUIDA, nunca el terreno.
    // Preferencia: ficha técnica (tipada) → spec destacado construido.
    const square_meters = specs.sqm_construida ?? sqmHighlightedBuilt ?? null
    const sqm_terreno = specs.sqm_terreno ?? sqmHighlightedTerreno ?? null

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
      advertiser_name, advertiser_type, advertiser_id, advertiser_logo,
      property_code, seller_reference,
      has_video, video_modal_url,
      photos: photos.slice(0, 60),
      description,
      gallery_url: galleryUrl,
      photos_total_count: photosTotalCount,
      ...specs,
      sqm_terreno,  // override: solo terreno real (nunca la superficie total/construida)
    }
  } catch {
    return null
  }
}
