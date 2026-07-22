// ─────────────────────────────────────────────────────────────────────────────
// Parsers del HTML de Portalinmobiliario.com (vertical inmobiliario de
// Mercado Libre Chile). Espeja la forma de `lib/parse.mjs` (Idealista):
// `parseListPage(html)` / `parseDetailPage(html, externalId)`.
//
// Portalinmobiliario comparte el frontend "Andes" de Mercado Libre: en el
// listado, cada anuncio es un <li class="ui-search-layout__item"> con un
// título en <h2 class="poly-component__title">; la ficha de detalle usa URLs
// con patrón `MLC-\d+`.
//
// CONFIRMADO (Fase 0, spike con 11 fichas reales descargadas manualmente —
// __NEXT_DATA__/__PRELOADED_STATE__/__INITIAL_STATE__ NO existen en este
// portal, esa hipótesis original era incorrecta): la ficha de detalle
// incrusta el estado inicial de Mercado Libre ("Nordic", el framework interno
// de ML) en `<script id="__NORDIC_RENDERING_CTX__">_n.ctx.r={...}</script>`.
// El JSON real cuelga de `blob.appProps.pageProps.initialState`. Dentro de
// `initialState`:
//   - `track.melidata_event.event_data`: price, currency_id ("CLF" = UF),
//     seller_id, seller_type, domain_id (ej. "MLC-HOUSES_FOR_RENT" → permite
//     derivar operación + tipo de propiedad), city (comuna), neighborhood.
//   - `components.header`: title, link_label.label.text (dirección visible).
//   - `components.location_and_points.map_info`: location.{latitude,longitude}
//     (las reales, no las del fallback regex anterior que devolvía siempre el
//     mismo valor), item_address, item_location ("Comuna, Región").
//   - `components.highlighted_specs_res.attributes[]`: dormitorios/baños/m²,
//     identificados por `icon.id` ∈ {BED, BATHROOM, SCALE_UP} + `label.text`
//     (la clase CSS `poly-component__attributes-item` que usábamos antes NO
//     existe en la ficha de detalle, solo en el listado).
//   - `components.seller_profile` (o `seller_profile_rex` en tiendas
//     oficiales): seller_name.title.text (nombre agencia),
//     bottom_extra_info[] con title.text "Código de la propiedad" →
//     subtitles[0].text = property_code (referencia canónica de ML, persiste
//     entre re-publicaciones).
//   - `components.code_internal` (cuando existe, mutuamente excluyente con
//     bottom_extra_info en las 11 fichas de muestra): label.text "Código
//     interno <ref>" = referencia interna de la corredora (seller_reference).
//   - `components.gallery_mosaic`: primary + secondary (siempre 5 fotos
//     embebidas en el HTML estático, sin importar `total_count` real, que va
//     de 11 a 30 en la muestra) + `has_video` + `media_counters[]` con la URL
//     del modal `vis-modals/gallery/{item_id}` que trae el resto de fotos y,
//     si existe, el reproductor de video. El video NUNCA aparece como URL de
//     archivo directa en el HTML estático de la ficha — solo el booleano
//     `has_video` y esa URL de modal; obtener el archivo real requiere un
//     fetch adicional a ese endpoint (pendiente para Fase 2).
//
// Si el blob no aparece o no parsea, las funciones degradan a selectores DOM
// con regex (best-effort) en vez de lanzar.
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

// ─── Fetch de la galería completa (Fase 2 del modal de Portal Inmobiliario) ───
async function fetchGalleryPhotos(galleryUrl) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const response = await fetch(galleryUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!response.ok) return []
    const html = await response.text()

    const photos = new Set()
    // Patrón 1: data-zoom
    for (const m of html.matchAll(/data-zoom="(https?:\/\/[^"]+\.(?:jpg|jpeg|webp))"/gi)) photos.add(m[1])
    // Patrón 2: img src (mlstatic)
    for (const m of html.matchAll(/src="(https?:\/\/http2\.mlstatic\.com\/[^\s"']+\.(?:jpg|jpeg|webp))"/gi)) photos.add(m[1])
    // Patrón 3: JSON embebido
    for (const m of html.matchAll(/"url":"(https?:\/\/[^"]+\.(?:jpg|jpeg|webp))"/gi)) photos.add(m[1])
    // Patrón 4: srcset
    for (const m of html.matchAll(/srcset="([^"]+)"/gi)) {
      for (const url of m[1].split(',')) {
        const urlMatch = url.match(/(https?:\/\/[^\s]+\.(?:jpg|jpeg|webp))/i)
        if (urlMatch) photos.add(urlMatch[1])
      }
    }
    return Array.from(photos)
  } catch (e) {
    console.warn('Error fetching gallery photos:', e.message)
    return []
  }
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

// ─── Helper: extracción del blob "Nordic" de Mercado Libre ──────────────────
// `<script id="__NORDIC_RENDERING_CTX__">_n.ctx.r={...};self.__LOADABLE...`
// El objeto puede contener strings con `{`/`}` (descripciones, JSON anidado
// escapado), así que un regex no-greedy (`\{[\s\S]*?\}`) puede truncar antes
// del cierre real o capturar de más. Se balancea por profundidad de llaves,
// ignorando contenido dentro de strings (y comillas escapadas).
function extractNordicBlob(html) {
  if (!html) return null
  const marker = html.match(/<script[^>]*id=["']__NORDIC_RENDERING_CTX__["'][^>]*>_n\.ctx\.r=/)
  if (!marker) return null

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

// `initialState` es donde vive todo lo útil; devolver directamente eso (o
// null) para que el resto del parser no tenga que repetir la ruta completa.
function extractInitialState(html) {
  const blob = extractNordicBlob(html)
  return blob?.appProps?.pageProps?.initialState ?? null
}

// ─── Parseo del LISTADO (blob Nordic, NO el HTML renderizado) ───────────────
// CONFIRMADO EN FASE 0 (HTML real de Las Condes, 48 tarjetas): los resultados de
// una página de listado NO viven en `<li class="ui-search-layout__item">` del
// HTML — esos marcadores son intervenciones (widgets de filtro/publicidad) y las
// pocas coincidencias que quedaban eran ocurrencias del string escapadas DENTRO
// del propio blob JSON. Un split por `<li>` "funcionaba" pero devolvía basura con
// forma de datos: tomaba un id de FOTO (`891463-MLC110284448549_042026`) como
// external_id y nunca sacaba precio/atributos. Los anuncios reales están en el
// mismo blob Nordic que la ficha (`initialState.results[].polycard`), como
// polycards con `metadata` (id/url/domain_id) + `components[]` (title, price,
// attributes_list, location, seller). Ver docs/research-portalinmobiliario-chile.md.

/** domain_id (ej. "MLC-INDIVIDUAL_HOUSES_FOR_SALE") → operación/tipo/es-proyecto. */
function parseDomainId(domainId = '') {
  const operation = /FOR_RENT/i.test(domainId) ? 'rent'
    : /FOR_SALE/i.test(domainId) ? 'sale'
    : null
  const property_type = /APARTMENT/i.test(domainId) ? 'departamento'
    : /HOUSE/i.test(domainId) ? 'casa'
    : null
  // DEVELOPMENT = proyecto nuevo (unidades múltiples, precio "Desde"). El plan
  // cubre primero casas USADAS (INDIVIDUAL), así que se expone para poder
  // filtrar los proyectos en el discovery aunque el listado los incluya.
  const is_development = /DEVELOPMENT/i.test(domainId)
  return { operation, property_type, is_development }
}

/** Texts de attributes_list (["4 dormitorios","3 baños","138 m² útiles"]). */
function parseAttributesTexts(texts = []) {
  let bedrooms = null, bathrooms = null, square_meters = null
  for (const t of texts) {
    if (bedrooms == null && /dormitor|habitaci/i.test(t)) bedrooms = toInt(t)
    else if (bathrooms == null && /bañ|bano/i.test(t)) bathrooms = toInt(t)
    else if (square_meters == null && /m²|m2/i.test(t)) square_meters = toInt(t)
  }
  return { bedrooms, bathrooms, square_meters }
}

/** El texto del vendedor trae placeholders de icono ("Enaco {icon_cockade}"). */
function cleanSellerText(text) {
  if (!text) return null
  const cleaned = decode(String(text).replace(/\{[^}]*\}/g, '')).trim()
  return cleaned || null
}

/**
 * Mapea UN polycard de resultado a la forma de anuncio del scraper. Puro y
 * exportado para test de regresión (blinda el bug histórico del external_id).
 * Devuelve null si el polycard no trae id (no es un anuncio direccionable).
 */
export function mapPolycard(polycard) {
  const meta = polycard?.metadata
  if (!meta?.id) return null

  // metadata.id viene sin guion ("MLC4205367480"); normalizar a "MLC-<n>", el
  // mismo formato que external_id en el resto del scraper y en la URL de ficha.
  const external_id = String(meta.id).replace(/^MLC-?/, 'MLC-')
  const rawUrl = meta.url ? String(meta.url) : null
  const source_url = rawUrl
    ? (rawUrl.startsWith('http') ? rawUrl : `https://www.${rawUrl}`)
    : `https://www.portalinmobiliario.com/${external_id}`

  const components = Array.isArray(polycard.components) ? polycard.components : []
  const comp = (type) => components.find((c) => c?.type === type)

  const title = decode(comp('title')?.title?.text ?? '') || null
  const { operation, property_type, is_development } = parseDomainId(meta.domain_id)

  const cp = comp('price')?.price?.current_price
  const price = cp?.value ?? null
  const currency = cp?.currency === 'CLF' ? 'UF' : (cp?.currency ?? 'CLP')
  // "Desde" en proyectos: el precio es el mínimo de las unidades, no el del anuncio.
  const price_from = Boolean(comp('price')?.price?.prefix?.text)

  const { bedrooms, bathrooms, square_meters } = parseAttributesTexts(comp('attributes_list')?.attributes_list?.texts ?? [])

  const location_text = decode(comp('location')?.location?.text ?? '') || null
  const advertiser_name = cleanSellerText(comp('seller')?.seller?.text)

  return {
    external_id,
    source_url,
    title,
    operation,
    property_type,
    is_development,
    price,
    currency,
    price_from,
    bedrooms,
    bathrooms,
    square_meters,
    location_text,
    advertiser_name,
    // El listado no distingue de forma fiable particular vs profesional
    // (la insignia "Tienda oficial" no implica los dos casos): eso se resuelve
    // en la ficha (parseDetailPage, vía seller_type). Aquí queda 'unknown'.
    advertiser_type: 'unknown',
  }
}

/**
 * Extrae los anuncios de una página de resultados de Portalinmobiliario desde el
 * blob Nordic. Devuelve un array de objetos de mapPolycard(), o `[]` si no hay
 * blob o no calza la estructura (nunca lanza). Un `[]` con HTML no vacío es señal
 * de parser roto / layout cambiado (alerta de observabilidad, H17).
 */
export function parseListPage(html) {
  try {
    if (!html) return []
    const state = extractInitialState(html)
    const results = Array.isArray(state?.results) ? state.results : []
    const out = []
    for (const r of results) {
      if (r?.id !== 'POLYCARD' || !r.polycard) continue
      const mapped = mapPolycard(r.polycard)
      if (mapped) out.push(mapped)
    }
    return out
  } catch {
    // Cualquier fallo inesperado de parseo: degradar a "sin resultados" en
    // vez de tumbar el scraper.
    return []
  }
}

/**
 * Metadatos de paginación/cobertura de una página de listado, desde el mismo
 * blob Nordic. Los usa el discovery crawler (H1) para saber cuántas páginas hay
 * (`pageCount`), cuántos resultados declara el portal (`total`, alimenta
 * `scrape_targets_cl.portal_reported_count`, gate ≥90% de H17/H22) y el TOPE de
 * paginación del portal (`resultsLimit`, típicamente 2000): Portalinmobiliario
 * NO deja paginar más allá de ~2000 resultados aunque `total` sea mayor, así que
 * un barrido de una comuna con `total > resultsLimit` NO es exhaustivo (crítico
 * para no dar de baja anuncios vivos, ver discovery-portalinmobiliario-cl.mjs).
 * Nunca lanza; devuelve nulls si no calza la estructura.
 *
 * @returns {{ total: number|null, pageCount: number|null, resultsLimit: number|null }}
 */
export function parseListMeta(html) {
  try {
    const state = extractInitialState(html)
    const md = state?.melidata_track?.event_data ?? state?.melidata_track ?? null
    const rawTotal = md?.total
    const rawPages = state?.pagination?.page_count
    const rawLimit = state?.pagination?.results_limit
    return {
      total: Number.isFinite(rawTotal) ? rawTotal : null,
      pageCount: Number.isFinite(rawPages) ? rawPages : null,
      resultsLimit: Number.isFinite(rawLimit) ? rawLimit : null,
    }
  } catch {
    return { total: null, pageCount: null, resultsLimit: null }
  }
}

/**
 * Parsea la ficha de detalle de Portalinmobiliario. Devuelve el objeto con
 * los mismos campos "core" que produce parseDetailPage de Idealista (en lo
 * que aplique a Chile) o `null` si no se pudo extraer nada coherente.
 *
 * Prioriza el blob "Nordic" embebido (ver extractNordicBlob/extractInitialState)
 * si existe; de lo contrario cae a selectores DOM con regex.
 */
export async function parseDetailPage(html, external_id) {
  try {
    if (!html) return null

    const state = extractInitialState(html)
    const comps = state?.components ?? {}
    const eventData = state?.track?.melidata_event?.event_data ?? null
    const sellerProfile = comps.seller_profile ?? comps.seller_profile_rex ?? comps.fixed?.seller_profile ?? comps.fixed?.seller_profile_rex ?? null
    const mapInfo = comps.location_and_points?.map_info ?? null

    const titleM = html.match(/<title>([^<]*)<\/title>/)
    const title = comps.header?.title ?? (titleM ? decode(titleM[1]).replace(/\s*[|-]\s*Portalinmobiliario.*$/i, '') : null)

    // domain_id (ej. "MLC-HOUSES_FOR_RENT" / "MLC-INDIVIDUAL_HOUSES_FOR_SALE")
    // codifica operación + tipo de propiedad de forma inequívoca.
    const domainId = eventData?.domain_id ?? ''
    const operation = /FOR_RENT/i.test(domainId) ? 'rent'
      : /FOR_SALE/i.test(domainId) ? 'sale'
      : (/arriendo|arrendar/i.test(`${title ?? ''} ${html.slice(0, 2000)}`) ? 'rent' : 'sale')
    const property_type = /APARTMENT/i.test(domainId) ? 'departamento'
      : /HOUSE/i.test(domainId) ? 'casa'
      : null

    // Precio: `event_data.price` es el monto crudo (sin formatear) y
    // `currency_id` viene como código ISO ("CLF" = Unidad de Fomento, no el
    // literal "UF") — normalizamos a la convención del resto del scraper.
    let price = eventData?.price ?? null
    let currency = eventData?.currency_id === 'CLF' ? 'UF' : (eventData?.currency_id ?? null)
    if (price == null) {
      const priceBlockM = html.match(/andes-money-amount__fraction[^>]*>([\d.,]+)/)
      price = priceBlockM ? toInt(priceBlockM[1]) : null
      currency = /\bUF\b/i.test(html.slice(0, priceBlockM ? priceBlockM.index + 50 : 0)) ? 'UF' : 'CLP'
    }
    currency = currency ?? 'CLP'

    // Coordenadas reales declaradas por el vendedor (a triangular después,
    // ver identity-resolution-cl.mjs) — confirmado en
    // `location_and_points.map_info.location`, distinto por cada ficha.
    const loc = mapInfo?.location ?? null
    const latitude = loc?.latitude != null ? parseFloat(loc.latitude) : null
    const longitude = loc?.longitude != null ? parseFloat(loc.longitude) : null

    // Dormitorios/baños/m²: `highlighted_specs_res.attributes[]`, cada uno
    // con `icon.id` ∈ {BED, BATHROOM, SCALE_UP} y `label.text` (ej. "5 dorm.",
    // "3 baños", "374 m² totales"). La clase CSS usada antes
    // (poly-component__attributes-item) solo existe en el listado.
    let bedrooms = null, bathrooms = null, square_meters = null
    const specAttrs = comps.highlighted_specs_res?.attributes ?? comps.fixed?.highlighted_specs_res?.attributes ?? []
    for (const a of specAttrs) {
      const iconId = a?.icon?.id
      const text = a?.label?.text
      if (!text) continue
      if (iconId === 'BED') bedrooms = toInt(text)
      else if (iconId === 'BATHROOM') bathrooms = toInt(text)
      else if (iconId === 'SCALE_UP') square_meters = toInt(text)
    }

    // Comuna/dirección: `event_data.city` es la comuna ya limpia; respaldo en
    // `map_info.item_location` ("Comuna, Región"). Dirección desde
    // `map_info.item_address`, con la línea visible del header como respaldo.
    const itemLocation = mapInfo?.item_location ?? null
    const comuna = eventData?.city || (itemLocation ? itemLocation.split(',')[0].trim() : null) || null
    const itemAddress = mapInfo?.item_address?.trim()
    const headerAddress = comps.header?.link_label?.label?.text?.replace(/^,\s*/, '').trim()
    const address = itemAddress || headerAddress || null

    // Fotos: `gallery_mosaic.primary` + `.secondary` — el HTML estático SOLO
    // trae estas (siempre 5 en la muestra real), sin importar `total_count`
    // (visto entre 11 y 30). El resto vive detrás del modal de galería
    // (`media_counters[].url`), que se fetch en `fetchGalleryPhotos` (Fase 2).
    const gallery = comps.gallery_mosaic ?? comps.fixed?.gallery_mosaic ?? null
    const photos = []
    const seenPhotos = new Set()
    const addPhoto = (url) => { if (url && !seenPhotos.has(url)) { seenPhotos.add(url); photos.push(url) } }
    if (gallery?.primary?.src) addPhoto(gallery.primary.src)
    for (const p of gallery?.secondary ?? []) addPhoto(p?.src)
    if (photos.length === 0) {
      // Sin blob: último recurso, regex sobre el HTML renderizado.
      for (const m of html.matchAll(/data-zoom="(https?:\/\/[^"]+\.(?:jpg|webp))"/g)) addPhoto(m[1])
      if (photos.length === 0) {
        for (const m of html.matchAll(/(https?:\/\/http2\.mlstatic\.com\/[^\s"']+\.(?:jpg|webp))/g)) addPhoto(m[1])
      }
    }
    const photosTotalCount = gallery?.total_count ?? (photos.length || null)
    const galleryMediaCounters = gallery?.media_counters ?? []
    const galleryUrl = galleryMediaCounters.find((m) => m?.type === 'photos')?.url ?? null
    const hasVideo = gallery?.has_video ?? false
    const videoModalUrl = galleryMediaCounters.find((m) => m?.type === 'video')?.url ?? null

    // Fetch del modal de galería (si existe) para obtener TODAS las fotos
    if (galleryUrl) {
      try {
        const galleryPhotos = await fetchGalleryPhotos(galleryUrl)
        for (const photo of galleryPhotos) {
          addPhoto(photo)
        }
      } catch (e) {
        console.warn(`Error fetching gallery photos from ${galleryUrl}:`, e.message)
      }
    }

    // Video: confirmado que el archivo real NUNCA aparece como URL directa en
    // el HTML estático de la ficha — solo el booleano `has_video` y la URL
    // del modal (`video_modal_url`). Mantenemos un intento best-effort por si
    // alguna ficha sí lo incrusta (ej. tour 360°/iframe embebido).
    const videos = []
    const videoSet = new Set()
    for (const m of html.matchAll(/"(?:videoUrl|video_url|url)":\s*"(https?:\/\/[^"]+\.(?:mp4|webm|mov)|(?:youtube|vimeo)[^"]*)"/g)) {
      const url = m[1]
      if (!videoSet.has(url)) { videoSet.add(url); videos.push(url) }
    }
    if (videos.length === 0) {
      for (const m of html.matchAll(/(https?:\/\/[^"']+mlstatic\.com\/[^\s"']*\.(?:mp4|webm|mov))/gi)) {
        const url = m[1]
        if (!videoSet.has(url)) { videoSet.add(url); videos.push(url) }
      }
    }

    const advertiser_name = sellerProfile?.seller_name?.title?.text ?? null
    // advertiser_id = seller_id de Mercado Libre: el id ESTABLE de la corredora,
    // clave de identidad de corredoras_cl (H4 / terna §2.1). Fuente primaria:
    // event_data.seller_id del blob Nordic. Fallbacks para que la empresa NUNCA
    // quede sin identificar aunque una variante de layout no traiga el blob:
    //   (a) el dataLayer de GTM (`"sellerId":<n>`), y
    //   (b) la URL del logo de tienda oficial
    //       (`classifieds_accounts/MLC_real_estate_agency/<id>_vip_…`).
    let advertiser_id = eventData?.seller_id != null ? String(eventData.seller_id) : null
    if (!advertiser_id) {
      const gtm = html.match(/"sellerId"\s*:\s*(\d+)/)
      if (gtm) advertiser_id = gtm[1]
    }
    if (!advertiser_id) {
      const logoId = html.match(/MLC_real_estate_agency\/(\d+)_/)
      if (logoId) advertiser_id = logoId[1]
    }
    // Logo de la corredora (tienda oficial), derivable del id — para la ficha de
    // corredora (H4/H5). NULL si el vendedor no tiene logo de tienda oficial.
    const advertiser_logo = (html.match(/https:\/\/resources\.mlstatic\.com\/classifieds_accounts\/MLC_real_estate_agency\/\d+_vip[^"'\\]*/) ?? [null])[0]
    const sellerType = eventData?.seller_type ?? null
    const advertiser_type = sellerType
      ? (sellerType === 'real_estate_agency' ? 'professional' : 'particular')
      : (advertiser_name ? 'professional' : 'unknown')

    // Property code (referencia canónica de ML, persiste en re-publicaciones):
    // `seller_profile(.rex)?.bottom_extra_info[]` con título "Código de la
    // propiedad" → subtitles[0].text.
    let property_code = null
    for (const item of sellerProfile?.bottom_extra_info ?? []) {
      if (/c[oó]digo de la propiedad/i.test(item?.title?.text ?? '')) {
        property_code = item?.subtitles?.[0]?.text ?? null
        break
      }
    }

    // Seller reference (referencia interna de la corredora en su CRM):
    // componente `code_internal`, label "Código interno <ref>". En la
    // muestra real es mutuamente excluyente con `bottom_extra_info` (nunca
    // aparecen ambos en la misma ficha).
    const codeInternalLabel = comps.code_internal?.label?.text ?? comps.fixed?.code_internal?.label?.text ?? null
    const seller_reference = codeInternalLabel
      ? codeInternalLabel.replace(/^c[oó]digo interno\s*/i, '').trim() || null
      : null

    const description = comps.description?.content ?? comps.description_rex?.content ?? null

    return {
      external_id,
      property_code,  // ID canónico de la propiedad (persiste en republicas)
      portal: 'portalinmobiliario',
      source_type: 'portal',
      source_url: `https://www.portalinmobiliario.com/${external_id}`,
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
      advertiser_id,
      advertiser_logo,
      seller_reference,
      photos: photos.slice(0, 30),  // Cap a 30 fotos (antes era 40)
      photos_total_count: photosTotalCount,  // total real declarado por el portal (puede ser > 30)
      gallery_url: galleryUrl,  // endpoint del modal con la galería completa (Fase 2: descarga real)
      has_video: hasVideo,
      video_modal_url: videoModalUrl,  // el archivo real no está en el HTML estático, solo este modal
      videos,  // URLs de video directas si alguna vez aparecen embebidas (raro)
      description,
    }
  } catch {
    // Estructura inesperada de la ficha: degradar a `null`, igual que un
    // resultado de "no se pudo parsear", en vez de tumbar el scraper.
    return null
  }
}
