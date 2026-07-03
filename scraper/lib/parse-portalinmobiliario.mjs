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
    const advertiser_id = eventData?.seller_id != null ? String(eventData.seller_id) : null
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
