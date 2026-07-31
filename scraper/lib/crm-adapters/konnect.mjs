// ─────────────────────────────────────────────────────────────────────────────
// crm-adapters/konnect.mjs — adaptador para Property Partners (plataforma
// propia "Konnect", plan Anuncios CL · Fase 4 / H21).
// Verificado contra la API real de ppartnersgroup.com (julio 2026).
//
// A diferencia de Convecta y Ofinet —CRM de terceros que muchas corredoras
// alquilan— Konnect es la plataforma del propio grupo Property Partners. Entra
// igualmente en el registro de adaptadores porque la mecánica es la misma (un
// adaptador, N dominios): si mañana otra oficina del grupo sale con su propio
// dominio sobre Konnect, se registra la fila y reusa este archivo.
//
// LA FUENTE ES UNA API JSON, NO HTML. El front es Next.js y el listado se
// resuelve en cliente contra /api/properties/listing/, que devuelve el objeto
// COMPLETO de cada propiedad —no un resumen de tarjeta—: código interno,
// coordenadas, superficies, dormitorios, baños, estacionamientos, bodegas,
// orientación, gastos comunes, fotos, vídeo, oficina, agente, fechas de
// publicación e HISTORIAL DE PRECIOS. Es más rica que la ficha HTML, así que el
// adaptador NO descarga la ficha: parseList ya devuelve todo lo que necesita
// upsertListingCl, y parseDetail solo se usa si alguna vez hace falta refrescar
// una ficha suelta.
//
// PARÁMETROS (probados uno a uno contra la API):
//   · countryId=cl        acota a Chile. Sin él devuelve el inventario global
//                         del grupo (16.264 fichas: Chile, Uruguay, EE.UU.,
//                         España, Argentina…).
//   · operation=sell|rent el nombre correcto es `operation`. OJO: `operationId`
//                         —que es como se llama el campo en las props de la
//                         página— la API lo IGNORA en silencio, devolviendo el
//                         listado sin filtrar con un total idéntico al de "sin
//                         filtro". Es el fallo silencioso más fácil de comer
//                         aquí: parece que funciona porque responde 200 y trae
//                         datos.
//   · typeId=all          todos los tipos de propiedad.
//   · page=N              100 fichas por página; `pagination.maxPages` dice
//                         cuántas hay, así que el barrido está acotado de
//                         antemano (no hace falta avanzar hasta la vacía).
// ─────────────────────────────────────────────────────────────────────────────
import { clean, cleanPhotos, siteBase } from './index.mjs'
import { normalizeDomain } from '../detect-corredora-crm-cl.mjs'

export const platform = 'konnect'

// El listado llega como JSON.
export const listIsJson = true
// La API ya devuelve la ficha entera dentro del listado: bajar la página HTML
// de cada propiedad sería una petición por ficha para obtener MENOS datos.
export const listIsComplete = true
export const pageSize = 100

const OPERATION_CODE = { sale: 'sell', rent: 'rent' }
const OPERATION_FROM_CODE = { sell: 'sale', rent: 'rent' }

// Códigos de tipo de la API → vocabulario de listings_cl. Se usa el MISMO que
// produce parsePropertyType (índice de adaptadores) para que una casa de Konnect
// y una de Convecta sean el mismo valor a la hora de filtrar y deduplicar:
// parcelas y sitios entran como 'terreno', no como categoría propia.
const TYPE_MAP = {
  apartment: 'departamento',
  house: 'casa',
  office: 'oficina',
  land: 'terreno',
  lot: 'terreno',
  farm: 'terreno',
  commercial: 'local',
  store: 'local',
  warehouse: 'bodega',
  building: 'edificio',
  parking: 'estacionamiento',
}

/**
 * URL de una página del listado.
 *
 * `operation` ausente = venta y arriendo juntos. `countryId` fijo a 'cl': este
 * adaptador alimenta el módulo chileno y el inventario global del grupo trae
 * fichas de otros cinco países.
 */
export function listUrl(domain, { operation, page = 1, baseUrl, countryId = 'cl' } = {}) {
  const params = new URLSearchParams({
    countryId,
    typeId: 'all',
    page: String(Math.max(1, Number(page) || 1)),
  })
  // Solo se manda si se pide: sin el parámetro la API devuelve ambas
  // operaciones, que es justo lo que queremos para un barrido completo.
  if (OPERATION_CODE[operation]) params.set('operation', OPERATION_CODE[operation])
  return `${siteBase(domain, baseUrl, { www: false })}/api/properties/listing/?${params.toString()}`
}

/**
 * URL pública de la ficha: /es-cl/propiedad/<slug>/<externalId>/
 * El slug es cosmético pero la ruta lo exige, así que se guarda del listado.
 */
export function detailUrl(domain, ref, { baseUrl, slug = '' } = {}) {
  const base = siteBase(domain, baseUrl, { www: false })
  const s = clean(slug) || 'propiedad'
  return `${base}/es-cl/propiedad/${encodeURIComponent(s)}/${encodeURIComponent(ref)}/`
}

/** [lng, lat] de GeoJSON → { latitude, longitude }, validado a Chile continental. */
function parsePoint(point) {
  const coords = point?.coordinates
  if (!Array.isArray(coords) || coords.length < 2) return { latitude: null, longitude: null }
  // GeoJSON es [longitud, latitud] — invertirlo pone las propiedades en el
  // océano Índico, y como el mapa igual pinta un pin es un error que no salta.
  const [lng, lat] = coords.map(Number)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { latitude: null, longitude: null }
  if (!(lat >= -56 && lat <= -17 && lng >= -76 && lng <= -66)) return { latitude: null, longitude: null }
  return { latitude: lat, longitude: lng }
}

/**
 * Convierte una propiedad de la API al objeto que espera upsertListingCl.
 * Exportada porque es la pieza que se testea con fixtures reales.
 */
export function toListing(prop, { domain = '', baseUrl } = {}) {
  if (!prop || typeof prop !== 'object') return null
  // externalId es el código interno de Property Partners (ej. "HU0920") y la
  // clave del seguimiento: es lo que aparece también en sus publicaciones de
  // portal, así que es lo que engancha el enlace determinista de Nivel 1.5.
  const ref = clean(prop.externalId ?? prop.id ?? prop._id)
  if (!ref) return null

  const d = normalizeDomain(domain)
  const f = prop.features ?? {}
  const currency = prop.currencyId === 'UF' ? 'UF' : 'CLP'
  const price = Number(prop.price)
  const hasPrice = Number.isFinite(price) && price > 0

  const { latitude, longitude } = parsePoint(prop.location)

  const features = []
  for (const o of Array.isArray(f.others) ? f.others : []) {
    const name = clean(o?.name)
    if (name) features.push(name)
  }
  if (f.parkplaces) features.push(`Estacionamientos: ${f.parkplaces}`)
  if (f.warehouses) features.push(`Bodegas: ${f.warehouses}`)
  if (f.lotSize) features.push(`Terreno: ${f.lotSize} m²`)
  if (f.age) features.push(`Año construcción: ${f.age}`)
  if (f.orientation?.name) features.push(`Orientación: ${f.orientation.name}`)
  if (f.condominiumFees) features.push(`Gastos comunes: ${f.condominiumFees}`)

  // videos llega como array que puede traer cadenas vacías.
  const video = (Array.isArray(prop.videos) ? prop.videos : []).map(clean).find(Boolean) || null
  const photos = cleanPhotos(Array.isArray(prop.images) ? prop.images : [])

  return {
    portal: `web:${d}`,
    source_type: 'agency_web',
    external_id: `${d}:${ref}`,
    source_url: detailUrl(domain, ref, { baseUrl, slug: prop.slug }),
    operation: OPERATION_FROM_CODE[prop.operation?.code] ?? null,
    property_type: TYPE_MAP[prop.type?.code] ?? null,
    advertiser_type: 'professional',
    // La oficina es el dato útil para captación: dice QUÉ sucursal del grupo
    // lleva la propiedad, no solo que es de Property Partners.
    advertiser_name: clean(prop.office?.name) ? `Property Partners ${clean(prop.office.name)}` : null,
    phone: clean(prop.office?.phone) || null,
    price: currency === 'CLP' && hasPrice ? price : null,
    price_uf: currency === 'UF' && hasPrice ? price : null,
    currency,
    bedrooms: Number.isFinite(Number(f.bedrooms)) ? Number(f.bedrooms) : null,
    bathrooms: Number.isFinite(Number(f.bathrooms)) ? Number(f.bathrooms) : null,
    square_meters: Number.isFinite(Number(f.buildSize)) ? Number(f.buildSize) : null,
    // location.name es la unidad territorial que la API asigna (comuna en
    // Santiago, provincia en regiones); fullName añade la región.
    comuna: clean(prop.location?.name) || null,
    address: clean(prop.location?.fullName) || null,
    latitude,
    longitude,
    description: clean(prop.description) || null,
    photos,
    photos_total_count: photos.length || null,
    features,
    has_video: Boolean(video),
    video_modal_url: video,
    property_code: null,
    advertiser_id: clean(prop.office?.externalId ?? '') || null,
    seller_reference: ref,
    crm_platform: platform,
    // Fecha de primera publicación declarada por la propia plataforma. Con ella
    // los días en mercado son un dato, no una estimación desde que lo vimos.
    portal_first_seen_at: prop.firstPublishedAt ?? prop.publishedAt ?? null,
  }
}

/**
 * Parsea una página del listado.
 *
 * Cada item trae `listing` ya normalizado: como la API devuelve la ficha
 * completa, el crawler puede hacer upsert directamente sin bajar el HTML de
 * cada propiedad (ver listIsComplete).
 *
 * @param {string|object} body
 * @returns {{ items: Array<{url:string, seller_reference:string, listing:object}>, total: number|null, lastPage: number|null }}
 */
export function parseList(body, { domain = '', baseUrl } = {}) {
  const empty = { items: [], total: null, lastPage: null }
  if (!body) return empty

  let payload
  try {
    payload = typeof body === 'string' ? JSON.parse(body) : body
  } catch {
    return empty
  }
  const data = payload?.data
  if (!data || !Array.isArray(data.properties)) return empty

  const items = []
  for (const prop of data.properties) {
    const listing = toListing(prop, { domain, baseUrl })
    if (listing) {
      items.push({ url: listing.source_url, seller_reference: listing.seller_reference, listing })
    }
  }

  const total = Number(data.pagination?.totalProperties)
  const lastPage = Number(data.pagination?.maxPages)
  return {
    items,
    total: Number.isFinite(total) ? total : null,
    lastPage: Number.isFinite(lastPage) && lastPage > 0 ? lastPage : null,
  }
}

/**
 * Ficha suelta. La API de detalle devuelve el MISMO objeto que el listado, así
 * que se reusa toListing. Existe para poder refrescar una propiedad concreta
 * (seguimiento por código) sin barrer el listado entero.
 */
export function parseDetail(body, { domain = '', baseUrl } = {}) {
  if (!body) return null
  let payload
  try {
    payload = typeof body === 'string' ? JSON.parse(body) : body
  } catch {
    return null
  }
  const prop = payload?.data?.property ?? payload?.data ?? payload
  return toListing(prop, { domain, baseUrl })
}
