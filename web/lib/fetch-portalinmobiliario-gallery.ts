import { ProxyAgent, type Dispatcher } from 'undici'

/**
 * Galería completa de Portal Inmobiliario — copia de web/ de la lógica que vive
 * en `scraper/lib/parse-portalinmobiliario.mjs` (fetchGalleryHtml /
 * fetchGalleryPhotos / fetchGalleryByItemId).
 *
 * ⚠ SI TOCAS ALGO AQUÍ, TÓCALO TAMBIÉN EN scraper/lib/parse-portalinmobiliario.mjs.
 * Está duplicado porque el build Docker de web/ no incluye scraper/lib (mismo
 * motivo que dedup-cl.ts). Y la divergencia entre las dos copias es EXACTAMENTE
 * lo que mantuvo vivo el bug "solo scrapea 5 fotos": los cuatro arreglos de
 * fotos (a088400, 493e3cc, 8ce2343, 0cb5e21) se aplicaron solo en el scraper, así
 * que el worker 24/7 traía 20-30 fotos y TODO lo que dispara la interfaz —el
 * botón "Re-scrapear" de la ficha, captar desde una URL, buscar por código— se
 * quedaba en 5. Ahora lo vigila lib/__tests__/gallery-cl-paridad.test.ts.
 *
 * POR QUÉ 5: el HTML de la ficha solo incrusta el `gallery_mosaic` del blob —
 * `primary` (1) + `secondary` (4). El resto vive en un modal aparte. Traer una
 * ficha completa son DOS peticiones, y si la segunda no llega te quedas en 5.
 * Por eso 5 nunca significa "están todas".
 */

/** El blob de la ficha sirve COMO MUCHO estas fotos. */
export const BLOB_PHOTO_CAP = 5

/** Solo son fotos del anuncio las que llevan id de Mercado Libre: los patrones
 *  de extracción son amplios a propósito y arrastran gráficos de la interfaz
 *  (los placeholders `big-empty-state.webp` de la galería vacía, por ejemplo). */
export const esFotoDeAnuncio = (url: string): boolean => /\d+-MLC\d+/.test(String(url ?? ''))

// La letra tras el id de la foto es el código de tamaño del CDN: -F es el mayor
// (800x597) y -O menos de la mitad de peso (500x373). Las fuentes NO coinciden
// —el blob sirve en -F y el modal por item id en -O—, así que sin normalizar,
// las primeras fotos se veían bien y el resto peor.
const CODIGO_TAMANO = /(D_(?:NQ_NP_)?(?:2X_)?\d+-MLC\d+(?:_\d+)?)-[A-Z]([-.])/
const TAMANO_MAXIMO = 'F'

/** Reescribe una URL de foto a la variante de más resolución que sirve el CDN. */
export const aMaximaResolucion = (url: string): string =>
  String(url ?? '').replace(CODIGO_TAMANO, `$1-${TAMANO_MAXIMO}$2`)

// Mismas variables de entorno y misma prioridad que scraper/lib/fetch.mjs
// (proxyUrl()) y captar-pipeline.ts (chileProxyUrl()) — un solo criterio
// compartido en todo el proyecto para elegir el proxy residencial de Chile.
function chileProxyUrl(): string | null {
  if (process.env.SMARTPROXY_URL) return process.env.SMARTPROXY_URL
  if (process.env.PROXY_URL) return process.env.PROXY_URL
  const { EVOMI_PROXY_HOST, EVOMI_PROXY_PORT, EVOMI_PROXY_USER, EVOMI_PROXY_PASS } = process.env
  if (EVOMI_PROXY_USER) return `http://${EVOMI_PROXY_USER}:${EVOMI_PROXY_PASS}@${EVOMI_PROXY_HOST}:${EVOMI_PROXY_PORT}`
  const { SMARTPROXY_CL_HOST, SMARTPROXY_CL_PORT, SMARTPROXY_CL_USER, SMARTPROXY_CL_PASS } = process.env
  if (SMARTPROXY_CL_USER) return `http://${SMARTPROXY_CL_USER}:${SMARTPROXY_CL_PASS}@${SMARTPROXY_CL_HOST}:${SMARTPROXY_CL_PORT}`
  return null
}

async function fetchVia(url: string, proxy: string | null): Promise<string | null> {
  const init: RequestInit & { dispatcher?: Dispatcher } = {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
    signal: AbortSignal.timeout(10000),
  }
  if (proxy) init.dispatcher = new ProxyAgent(proxy)
  try {
    const response = await fetch(url, init)
    return response.ok ? await response.text() : null
  } catch {
    return null
  }
}

/**
 * HTML del modal, con la MISMA política de red que la ficha principal: siempre
 * por proxy salvo que se desactive con PI_SOLO_PROXY=0 (ver fetch.mjs). Sin
 * esto, cada ficha hacía una petición directa desde la IP del VPS y el esfuerzo
 * de esconderla en la ficha principal no servía de nada.
 */
async function fetchGalleryHtml(url: string, { forceProxy = false } = {}): Promise<string | null> {
  const proxy = chileProxyUrl()
  if ((forceProxy || process.env.PI_SOLO_PROXY !== '0') && proxy) {
    return fetchVia(url, proxy)
  }
  const directo = await fetchVia(url, null)
  if (directo) return directo
  return proxy ? fetchVia(url, proxy) : null
}

/**
 * ¿Merece la pena reintentar por proxy? Sí si no vino ninguna foto, y también
 * si vinieron MENOS de las que el portal declara.
 *
 * Un bloqueo no siempre llega vacío: llega como un 200 con la página a medias,
 * que no lanza excepción ni es `!response.ok`. Dando por buena esa respuesta,
 * una galería de 29 fotos se guardaba con 17 —o con 0, dejando el anuncio en
 * las 5 del blob— y nadie volvía a mirarla porque "ya tenía fotos".
 *
 * Sin total declarado solo se reintenta si vino vacía: no hay contra qué
 * comparar y no se puede pedir el modal en bucle.
 */
export function incompleta(obtenidas: number, esperadas: number | null | undefined): boolean {
  if (obtenidas === 0) return true
  return esperadas != null && obtenidas < esperadas
}

function extraerFotosDeGaleria(html: string | null): string[] {
  if (!html) return []
  const photos = new Set<string>()
  // Patrón 1: data-zoom (carrusel/galería)
  for (const m of html.matchAll(/data-zoom="(https?:\/\/[^"]+\.(?:jpg|jpeg|webp))"/gi)) photos.add(m[1])
  // Patrón 2: img src con mlstatic (resolución completa)
  for (const m of html.matchAll(/src="(https?:\/\/http2\.mlstatic\.com\/[^\s"']+\.(?:jpg|jpeg|webp))"/gi)) photos.add(m[1])
  // Patrón 3: URLs en JSON embebido
  for (const m of html.matchAll(/"url":"(https?:\/\/[^"]+\.(?:jpg|jpeg|webp))"/gi)) photos.add(m[1])
  // Patrón 4: srcset (puede traer varias resoluciones)
  for (const m of html.matchAll(/srcset="([^"]+)"/gi)) {
    for (const url of m[1].split(',')) {
      const urlMatch = url.match(/(https?:\/\/[^\s]+\.(?:jpg|jpeg|webp))/i)
      if (urlMatch) photos.add(urlMatch[1])
    }
  }
  // Los cuatro patrones son amplios a propósito, así que arrastran gráficos de
  // la interfaz: solo cuentan las que llevan id de Mercado Libre.
  return [...photos].filter(esFotoDeAnuncio).map(aMaximaResolucion)
}

/** Fotos del modal de galería que anuncia el blob (`media_counters[].url`). */
export async function fetchPortalInmobiliarioGallery(
  galleryUrl: string,
  { esperadas = null }: { esperadas?: number | null } = {},
): Promise<string[]> {
  if (!galleryUrl) return []
  try {
    let fotos = extraerFotosDeGaleria(await fetchGalleryHtml(galleryUrl))
    if (incompleta(fotos.length, esperadas)) {
      const porProxy = extraerFotosDeGaleria(await fetchGalleryHtml(galleryUrl, { forceProxy: true }))
      if (porProxy.length > fotos.length) fotos = porProxy
    }
    return fotos
  } catch (error) {
    console.error('Error fetching Portal Inmobiliario gallery:', error)
    return []
  }
}

/**
 * Galería COMPLETA por item_id: el modal /vis-modals/gallery/{itemId} lista los
 * IDs de TODAS las fotos y la URL se arma con el template del CDN.
 *
 * Más fiable que depender del `media_counters.url` del blob, que A VECES NO
 * VIENE — y sin él no había ni segunda petición, así que la ficha se quedaba en
 * las 5 del mosaico sin que nada fallara visiblemente.
 */
export async function fetchGalleryByItemId(
  externalId: string,
  { esperadas = null }: { esperadas?: number | null } = {},
): Promise<string[]> {
  try {
    const id = String(externalId).replace(/[^A-Z0-9]/gi, '') // "MLC-123" → "MLC123"
    if (!/^MLC\d+$/i.test(id)) return []
    const url = `https://www.portalinmobiliario.com/vis-modals/gallery/${id}`
    const idsDe = (html: string | null): string[] => {
      const ids: string[] = []
      if (!html) return ids
      for (const m of html.matchAll(/\d{6}-MLC\d+(?:_\d{6})?/g)) {
        if (!ids.includes(m[0])) ids.push(m[0])
      }
      return ids
    }
    let ids = idsDe(await fetchGalleryHtml(url))
    if (incompleta(ids.length, esperadas)) {
      const porProxy = idsDe(await fetchGalleryHtml(url, { forceProxy: true }))
      if (porProxy.length > ids.length) ids = porProxy
    }
    return ids.map((pid) => `https://http2.mlstatic.com/D_NQ_NP_${pid}-${TAMANO_MAXIMO}.webp`)
  } catch (error) {
    console.error('Error fetching gallery by item id:', error)
    return []
  }
}

/**
 * Todas las fotos que se puedan conseguir, en el mismo orden de prioridad que
 * el worker: las del blob, el modal que anuncia el blob y —si seguimos en el
 * tope de 5 o por debajo de lo declarado— el modal por item id.
 *
 * Es el punto ÚNICO que deben usar los caminos de web/ (re-scrapear desde la
 * ficha, captar por URL o por pin, buscar por código), para que ninguno se
 * vuelva a quedar con las 5 del mosaico.
 */
export async function fetchTodasLasFotos({
  delBlob, galleryUrl, externalId, esperadas = null,
}: {
  delBlob: string[]
  galleryUrl?: string | null
  externalId?: string | null
  esperadas?: number | null
}): Promise<string[]> {
  const porId = new Map<string, string>()
  const add = (url: string) => {
    if (!url || !esFotoDeAnuncio(url)) return
    const key = url.match(/\d+-MLC\d+/)?.[0] ?? url
    if (!porId.has(key)) porId.set(key, aMaximaResolucion(url))
  }
  for (const url of delBlob) add(url)

  if (galleryUrl) {
    for (const url of await fetchPortalInmobiliarioGallery(galleryUrl, { esperadas })) add(url)
  }
  // El blob sirve como mucho 5, así que tener 5 nunca significa "están todas".
  if (externalId && (porId.size <= BLOB_PHOTO_CAP || porId.size < (esperadas ?? 0))) {
    for (const url of await fetchGalleryByItemId(externalId, { esperadas })) add(url)
  }
  return [...porId.values()]
}
