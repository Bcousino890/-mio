// ─────────────────────────────────────────────────────────────────────────────
// Mapeo captaciones_cl (-mio) → contrato de captación de SmartBC v1.
//
// Funciones puras: entra el "bundle" que arma la consulta de smartbc-sync-cl.mjs
// (captación + su comuna + su property_cl + todos los listings_cl del grupo) y
// sale el payload JSON. Sin red, sin BD — por eso se puede testear entero.
//
// Tres reglas que gobiernan todo el archivo, del contrato de SmartBC:
//
//   1. Un campo desconocido es un ERROR, no un aviso: el schema es
//      `additionalProperties: false`. Por eso nunca se cuela un campo "de más"
//      con datos nuestros — lo que no tiene hueco en el contrato va a `metadata`.
//   2. No se inventan valores de enumeración: lo que no encaja en la lista
//      cerrada cae a `other` y el valor original queda anotado en `metadata`.
//   3. Los campos del EQUIPO (propietario, dirección real, comuna, rol, notas,
//      etapa, asignación) se mandan pero SmartBC solo los escribe si están
//      vacíos. No usamos `options.overwrite_manual_fields` jamás: si una
//      captadora consiguió el teléfono real del dueño, nuestra sincronización
//      no puede borrarlo.
//
// La distinción que más importa está en `owner.confirmed` — ver CONFIRMED_NOTE.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto'
import { PASSTHROUGH } from './catalogo.mjs'
// Los parentescos viven aparte porque también los usa la ficha de Captación en
// el navegador, y este módulo importa node:crypto (ver relaciones.mjs).
import { splitRelaciones } from './relaciones.mjs'
import { formatRolCl } from '../rol-format.mjs'
export { splitRelaciones }

/**
 * "Confirmada" NO significa lo mismo en los dos sistemas y confundirlo corrompe
 * el pipeline comercial de SmartBC:
 *
 *   · en -mio  → el ROL SII y el DUEÑO están confirmados documentalmente
 *                (match ≥0.92, y con match_verified la dirección del
 *                certificado TGR coincide con la del SII).
 *   · en SmartBC → `owner.confirmed` = EL DUEÑO QUIERE VENDER, y mueve la ficha
 *                a la etapa "Confirmada".
 *
 * Nadie llama al propietario desde -mio, así que ese dato no lo tenemos: se
 * decide en SmartBC después de hablar con él. Por eso `owner.confirmed` no se
 * envía nunca, ni siquiera como `false`.
 */
export const CONFIRMED_NOTE = 'owner.confirmed lo decide el equipo de SmartBC tras hablar con el dueño'

export const EXTERNAL_ID_PREFIX = 'mio-'

/** Topes del contrato (§9 de la referencia de la API). */
export const LIMITS = {
  title: 500,
  description: 20_000,
  features: 100,
  contacts: 20,
  extraPhones: 20,
  photos: 60,
  listings: 20,
  addressScraped: 500,
  brokerName: 200,
  externalReference: 120,
  publicationNumber: 80,
  notes: 5_000,
  ownerContact: 500,
  relationship: 120,
  rut: 30,
  phone: 40,
}

// ─── Enumeraciones ───────────────────────────────────────────────────────────

/** `sale`/`rent` (-mio) → `venta`/`arriendo` (SmartBC). */
export function mapOperation(op) {
  if (op === 'sale') return 'venta'
  if (op === 'rent') return 'arriendo'
  return null
}

/**
 * Tipo de propiedad → lista cerrada de SmartBC. El origen guarda el texto que
 * publicó el portal ('casa', 'departamento', 'parcela'…), no un enum, así que
 * se normaliza sin acentos y lo no reconocido cae a `other` (nunca se inventa
 * un valor: el original viaja en metadata.property_type_origen).
 */
export function mapPropertyType(raw) {
  if (!raw) return null
  const t = String(raw).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  if (/\b(casa|chalet|vivienda)\b/.test(t)) return 'house'
  if (/\b(departamento|depto|apartamento|penthouse|loft|studio)\b/.test(t)) return 'apartment'
  if (/\b(terreno|parcela|sitio|lote|agricola|campo)\b/.test(t)) return 'land'
  if (/\boficina\b/.test(t)) return 'office'
  if (/\b(local|comercial|bodega|industrial|galpon)\b/.test(t)) return 'commercial'
  return 'other'
}

/**
 * Relación DealerNet → `contact_type`. El texto original se conserva siempre en
 * `relationship`, porque "Suegra" y "Cuñado" son ambos `family` para SmartBC
 * pero no son lo mismo para quien va a llamar.
 */
export function mapContactType(relacion) {
  if (!relacion) return 'other'
  const r = String(relacion).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (/conyuge|esposo|esposa|marido|pareja|convivient/.test(r)) return 'spouse'
  if (/hij|madre|padre|mama|papa|herman|abuel|niet|tio|tia|sobrin|primo|prima|suegr|cunad|yerno|nuera|familiar/.test(r)) return 'family'
  return 'other'
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

const trunc = (v, max) => (v == null ? null : String(v).slice(0, max) || null)
const numOrNull = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const intOrNull = (v) => {
  const n = numOrNull(v)
  return n == null ? null : Math.trunc(n)
}
/** jsonb que puede llegar como array, como string JSON o como null. */
function asArray(v) {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed : []
    } catch { return [] }
  }
  return []
}
function asObject(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch { return {} }
  }
  return {}
}
const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u) && u.length <= 2000

export function externalIdFor(captacionId) {
  return `${EXTERNAL_ID_PREFIX}${captacionId}`
}

/**
 * Moneda dual UF/CLP. El origen guarda AMBOS valores (el publicado y su
 * conversión), pero SmartBC guarda un precio y una moneda: hay que elegir, y se
 * elige el precio TAL CUAL LO PUBLICÓ el aviso. Mandar el CLP convertido con
 * `currency: "uf"` (o al revés) desplazaría el histórico de precios de SmartBC
 * cada vez que se mueve la UF, sin que el aviso haya cambiado de precio.
 */
export function pickPrice({ price, price_uf: priceUf, currency }) {
  const cur = currency == null ? null : String(currency).toLowerCase()
  if (cur === 'uf') {
    const uf = numOrNull(priceUf)
    if (uf != null) return { price: uf, currency: 'uf' }
  }
  const clp = numOrNull(price)
  if (clp != null) return { price: clp, currency: 'clp' }
  const uf = numOrNull(priceUf)
  if (uf != null) return { price: uf, currency: 'uf' }
  return { price: null, currency: null }
}

/**
 * Ordena los teléfonos de DealerNet de "más probable que conteste el dueño" a
 * menos: categoría probable antes que alternativo/laboral, luego calidad y
 * ranking del propio proveedor, y a igualdad, WhatsApp primero.
 */
export function sortPhones(phones) {
  const rank = { probable: 0, alternativo: 1, laboral: 2 }
  return [...phones].sort((a, b) => {
    const ca = rank[a?.categoria] ?? 3
    const cb = rank[b?.categoria] ?? 3
    if (ca !== cb) return ca - cb
    const qa = numOrNull(a?.calidad) ?? -1
    const qb = numOrNull(b?.calidad) ?? -1
    if (qa !== qb) return qb - qa
    const ra = numOrNull(a?.ranking) ?? -1
    const rb = numOrNull(b?.ranking) ?? -1
    if (ra !== rb) return rb - ra
    return (b?.whatsapp === true ? 1 : 0) - (a?.whatsapp === true ? 1 : 0)
  })
}

/**
 * Contactos de la ficha. El titular siempre; de los relacionados, SOLO los que
 * tienen teléfono.
 *
 * DealerNet devuelve decenas de relacionados (RUT + nombre + parentesco) y el
 * contrato admite 20 contactos: mandar la lista entera desplazaría a los que sí
 * sirven. Un relacionado sin teléfono no es accionable para quien va a llamar,
 * así que se cuenta en metadata y no se envía. El cruce teléfono↔persona se hace
 * por el parentesco, que es lo único que comparten ambas estructuras.
 */
export function buildContacts({ captacionId, ownerName, ownerRut, phones, emails, relacionados, seleccion }) {
  // Si alguien del equipo eligió a mano qué teléfonos van, manda esa decisión y
  // solo esa. Es lo contrario de "completar con lo que haya": los números que
  // DealerNet descubra después NO se cuelan solos en la ficha del CRM, esperan
  // a que alguien los apruebe. Quien mira la ficha sabe cuál de los 12 números
  // es el del dueño; el volcado automático, no.
  if (Array.isArray(seleccion) && seleccion.length) {
    return buildContactsFromSeleccion({ captacionId, ownerName, ownerRut, emails, seleccion })
  }
  const sorted = sortPhones(phones.filter((p) => p?.numero))
  // Los teléfonos SIN parentesco son del titular; los que traen `relacion`
  // pertenecen a esa persona relacionada (así los clasifica DealerNet).
  const ownerPhones = sorted.filter((p) => !p.relacion)
  const relPhones = sorted.filter((p) => p.relacion)

  const contacts = []
  const [firstOwnerPhone, ...restOwnerPhones] = ownerPhones.length ? ownerPhones : sorted
  const ownerExtras = (ownerPhones.length ? restOwnerPhones : []).slice(0, LIMITS.extraPhones)

  contacts.push({
    external_id: `${externalIdFor(captacionId)}-owner`,
    contact_type: 'owner',
    contact_name: trunc(ownerName, 200),
    phone: trunc(firstOwnerPhone?.numero, LIMITS.phone),
    email: emails[0]?.email ?? null,
    has_whatsapp: firstOwnerPhone?.whatsapp ?? null,
    relationship: null,
    rut: trunc(ownerRut, LIMITS.rut),
    extra_phones: ownerExtras.length
      ? ownerExtras.map((p) => ({
          phone: trunc(p.numero, LIMITS.phone),
          has_whatsapp: p.whatsapp ?? null,
          label: trunc(p.tipo ?? p.categoria, 80),
        }))
      : null,
  })

  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  const seen = new Set()
  for (const rel of relacionados) {
    if (contacts.length >= LIMITS.contacts) break
    // Un tel\u00e9fono puede pertenecer a varias personas a la vez ("Conyuge, Hija,
    // Suegra"): cuenta como suyo si su relaci\u00f3n aparece en esa lista, no solo
    // si la cadena entera coincide.
    const suyos = relPhones.filter((p) =>
      splitRelaciones(p.relacion).some((r) => norm(r) === norm(rel?.relacion)))
    if (!suyos.length) continue
    const rut = rel?.rut != null ? `${rel.rut}${rel.dv ? `-${rel.dv}` : ''}` : null
    const key = rut ?? norm(rel?.nombre)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const [principal, ...extras] = suyos
    contacts.push({
      external_id: `${externalIdFor(captacionId)}-rel-${rut ?? norm(rel?.nombre).replace(/\s+/g, '-')}`,
      contact_type: mapContactType(rel?.relacion),
      contact_name: trunc(rel?.nombre, 200),
      phone: trunc(principal.numero, LIMITS.phone),
      email: null,
      has_whatsapp: principal.whatsapp ?? null,
      relationship: trunc(rel?.relacion, LIMITS.relationship),
      rut: trunc(rut, LIMITS.rut),
      extra_phones: extras.length
        ? extras.slice(0, LIMITS.extraPhones).map((p) => ({
            phone: trunc(p.numero, LIMITS.phone),
            has_whatsapp: p.whatsapp ?? null,
            label: trunc(p.tipo ?? p.categoria, 80),
          }))
        : null,
    })
  }
  return contacts
}

/**
 * Contactos a partir de la selección manual del equipo.
 *
 * Cada entrada elegida trae su teléfono Y el nombre con el que debe viajar.
 * Hace falta porque DealerNet entrega las dos mitades por separado: en el
 * teléfono solo pone el parentesco ("Conyuge, Hija, Suegra") y los nombres van
 * en la lista de relacionados, sin decir cuál de ellos usa ese número. Quien
 * mira la ficha tiene las dos cosas delante y cierra la correspondencia; es el
 * nombre que acaba viendo quien llama desde el CRM.
 *
 * Se agrupan por persona: varios teléfonos de un mismo contacto van como
 * `extra_phones` suyos, no como contactos repetidos.
 */
function buildContactsFromSeleccion({ captacionId, ownerName, ownerRut, emails, seleccion }) {
  const porPersona = new Map()
  for (const sel of seleccion) {
    if (!sel?.phone) continue
    const esTitular = sel.is_owner === true || sel.contact_type === 'owner'
    // Clave de agrupación: el RUT si lo hay, si no el nombre, y si tampoco,
    // el propio teléfono (un número suelto es su propio contacto).
    const clave = esTitular
      ? 'owner'
      : (sel.rut ?? sel.name ?? sel.phone).toString().toLowerCase().trim()
    if (!porPersona.has(clave)) porPersona.set(clave, { esTitular, sel, telefonos: [] })
    porPersona.get(clave).telefonos.push(sel)
  }

  const contacts = []
  // El titular primero: es a quien se llama, y `owner.phone` sale de aquí.
  const orden = [...porPersona.entries()].sort(([a], [b]) => (a === 'owner' ? -1 : b === 'owner' ? 1 : 0))

  for (const [clave, grupo] of orden) {
    if (contacts.length >= LIMITS.contacts) break
    const [principal, ...extras] = grupo.telefonos
    const esTitular = grupo.esTitular
    contacts.push({
      external_id: `${externalIdFor(captacionId)}-${esTitular ? 'owner' : `sel-${slugClave(clave)}`}`,
      contact_type: esTitular ? 'owner' : (principal.contact_type ?? mapContactType(principal.relationship)),
      contact_name: trunc(principal.name ?? (esTitular ? ownerName : null), 200),
      phone: trunc(principal.phone, LIMITS.phone),
      email: esTitular ? (emails[0]?.email ?? null) : null,
      has_whatsapp: principal.has_whatsapp ?? null,
      relationship: esTitular ? null : trunc(principal.relationship, LIMITS.relationship),
      rut: trunc(principal.rut ?? (esTitular ? ownerRut : null), LIMITS.rut),
      extra_phones: extras.length
        ? extras.slice(0, LIMITS.extraPhones).map((p) => ({
            phone: trunc(p.phone, LIMITS.phone),
            has_whatsapp: p.has_whatsapp ?? null,
            label: trunc(p.label ?? p.relationship, 80),
          }))
        : null,
    })
  }
  return contacts
}

function slugClave(clave) {
  return String(clave).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'x'
}

/**
 * Galería. Se prefieren las fotos ya re-alojadas en nuestro bucket
 * (`stored_photos[].bucket_url`) sobre las URLs del portal: las de los portales
 * caducan, y SmartBC va a descargar cada foto para re-alojarla a su vez.
 *
 * `selected_photo_urls` NO recorta la galería — es el subconjunto que el equipo
 * eligió para la verificación visual con IA (fachada, piscina, techo), no el
 * álbum del inmueble. Solo decide la portada.
 */
export function buildPhotos({ photos, storedPhotos, selectedPhotoUrls }) {
  const byOriginal = new Map()
  for (const sp of storedPhotos) {
    if (sp?.original_url && isHttpUrl(sp?.bucket_url)) byOriginal.set(sp.original_url, sp.bucket_url)
  }
  const ordered = []
  const seen = new Set()
  const push = (url) => {
    const final = byOriginal.get(url) ?? url
    if (isHttpUrl(final) && !seen.has(final)) { seen.add(final); ordered.push(final) }
  }
  for (const url of selectedPhotoUrls) push(url)   // la portada primero
  for (const url of photos) push(url)
  for (const sp of storedPhotos) push(sp?.bucket_url)

  return ordered.slice(0, LIMITS.photos).map((url, position) => ({ url, position }))
}

/** Características: las del anuncio más las que el parser dejó estructuradas. */
export function buildFeatures(features, raw) {
  const out = []
  for (const f of features) {
    if (typeof f === 'string' && f.trim()) out.push(f.trim())
    else if (f && typeof f === 'object' && typeof f.name === 'string') out.push(f.name.trim())
  }
  if (raw.has_pool === true) out.push('Piscina')
  if (raw.is_condo === true) out.push('Condominio')
  const parking = intOrNull(raw.parking)
  if (parking) out.push(`${parking} estacionamiento${parking > 1 ? 's' : ''}`)
  const storage = intOrNull(raw.storage)
  if (storage) out.push(`${storage} bodega${storage > 1 ? 's' : ''}`)
  const year = intOrNull(raw.year_built)
  if (year) out.push(`Construida en ${year}`)
  if (typeof raw.orientation === 'string' && raw.orientation.trim()) out.push(`Orientación ${raw.orientation.trim()}`)

  const seen = new Set()
  return out.filter((f) => {
    const k = f.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).slice(0, LIMITS.features)
}

/** Nº de publicación del portal: "MLC-3914632576" → "3914632576". */
export function publicationNumber(externalId) {
  if (!externalId) return null
  return trunc(String(externalId).replace(/^MLC-?/i, ''), LIMITS.publicationNumber)
}

/**
 * Pestaña "Corredoras": la misma propiedad publicada por otras corredoras.
 *
 * El anuncio de la web propia de una corredora NO se manda como aviso aparte:
 * se PLIEGA dentro del aviso de portal de esa misma corredora, en los campos
 * `broker_*`. Es exactamente la distinción que SmartBC modela (precio del portal
 * vs. precio en la web de la corredora) y lo que permite que su histórico
 * separe bien los dos orígenes. Mandarlos sueltos duplicaría la misma corredora
 * dos veces en la pestaña y falsearía el "nº de corredoras" del inmueble.
 */
export function buildListings(listings, {
  principalId = null,
  principalTitle = null,
  principalRaw = {},
  normalizer = PASSTHROUGH,
} = {}) {
  const extrasFor = (l) => (l.id === principalId
    ? { title: principalTitle, raw: principalRaw, normalizer }
    : { title: null, raw: {}, normalizer })
  const portales = listings.filter((l) => l.source_type === 'portal')
  const webs = listings.filter((l) => l.source_type !== 'portal')
  const webByCorredora = new Map()
  for (const w of webs) {
    const key = w.corredora_id ?? w.advertiser_id ?? `nombre:${(w.corredora_name ?? w.advertiser_name ?? '').toLowerCase()}`
    if (key && !webByCorredora.has(key)) webByCorredora.set(key, w)
  }

  const out = []
  const usedWebs = new Set()

  for (const l of portales) {
    const key = l.corredora_id ?? l.advertiser_id ?? `nombre:${(l.corredora_name ?? l.advertiser_name ?? '').toLowerCase()}`
    const web = key ? webByCorredora.get(key) : null
    if (web) usedWebs.add(web.id)
    out.push(avisoFrom(l, web, extrasFor(l)))
  }
  // Webs propias sin aviso de portal de la misma corredora: van solas — son
  // inventario que solo está en su web ("inventario oculto"), no un duplicado.
  for (const w of webs) {
    if (!usedWebs.has(w.id)) out.push(avisoFrom(w, null, extrasFor(w)))
  }

  // Dedup por source_url, como exige el contrato, y tope de 20.
  const seen = new Set()
  return out.filter((a) => {
    if (!a.source_url || seen.has(a.source_url)) return false
    seen.add(a.source_url)
    return true
  }).slice(0, LIMITS.listings)
}

/**
 * Un aviso de la pestaña "Corredoras".
 *
 * `title` y `useful_square_meters` llegan por `extras` en vez de leerse de la
 * fila: `listings_cl` no guarda ni el título ni el desglose de superficies del
 * anuncio (solo `square_meters`), así que el único aviso del que conocemos esos
 * datos es el que originó la captación — de ahí salen `cap.title` y
 * `cap.raw_extracted.sqm_construida`. Para el resto se omiten en vez de
 * rellenarlos con los del anuncio principal, que es otro anuncio.
 */
function avisoFrom(l, web, { title = null, raw = {}, normalizer = PASSTHROUGH } = {}) {
  const stored = asArray(l.stored_photos)
  const photoUrls = stored.map((sp) => sp?.bucket_url).filter(isHttpUrl)
  const fallbackPhotos = asArray(l.photos).filter(isHttpUrl)
  const fotos = (photoUrls.length ? photoUrls : fallbackPhotos).slice(0, LIMITS.photos)
  const { price, currency } = pickPrice(l)
  const brokerPrice = web ? pickPrice(web) : { price: null, currency: null }

  return {
    external_id: `mio-lst-${l.id}`,
    source_url: l.source_url,
    source_site: trunc(l.portal, 100),
    broker_name: trunc(l.corredora_name ?? l.advertiser_name, LIMITS.brokerName),
    external_reference: trunc(l.seller_reference, LIMITS.externalReference),
    title: trunc(title, LIMITS.title),
    description: trunc(l.description, LIMITS.description),
    price,
    currency,
    bedrooms: intOrNull(l.bedrooms),
    bathrooms: intOrNull(l.bathrooms),
    square_meters: intOrNull(l.square_meters),
    useful_square_meters: intOrNull(raw.sqm_construida),
    region: trunc(
      normalizer.region(normalizer.regionDeComuna(l.comuna_name ?? l.comuna_raw) ?? l.comuna_region),
      120,
    ),
    commune: trunc(normalizer.comuna(l.comuna_name ?? l.comuna_raw), 120),
    zone: trunc(normalizer.zona(l.comuna_name ?? l.comuna_raw, l.localidad), 120),
    address_scraped: trunc(l.address, LIMITS.addressScraped),
    latitude: numOrNull(l.latitude),
    longitude: numOrNull(l.longitude),
    cover_photo_url: fotos[0] ?? null,
    photo_urls: fotos.length ? fotos : null,
    features: buildFeatures(asArray(l.features), raw).slice(0, LIMITS.features),
    operation: mapOperation(l.operation),
    portal_publication_number: publicationNumber(l.external_id),
    // `published_ago` no se envía: el origen no guarda la fecha de publicación
    // del portal, solo cuándo lo vimos nosotros por primera vez. Derivar
    // "Publicado hace 2 meses" de ese dato sería afirmar algo que no sabemos.
    broker_website_url: web?.source_url ?? null,
    broker_price: brokerPrice.price,
    broker_currency: brokerPrice.currency,
    broker_scraped_at: web?.detail_parsed_at ? new Date(web.detail_parsed_at).toISOString() : null,
    // `broker_scrape_error` / `scrape_error` no se envían: el origen no guarda
    // el error del último crawl por anuncio (solo si la ficha se pudo parsear o
    // no, vía detail_parsed_at). Inventar un texto de error sería peor que el
    // silencio.
    scrape_status: l.status === 'gone' ? 'gone' : 'scraped',
  }
}

/** Elimina claves nulas para no mandar ruido (y no pisar con null sin querer). */
export function pruneNulls(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out
}

/**
 * Payload completo de una captación.
 *
 * @param {object} bundle  { captacion, comuna, property, listings }
 * @param {object} [options]
 * @param {string|null} [options.stage]      etapa inicial (solo se aplica al crear)
 * @param {boolean} [options.includeNotes]   línea de procedencia en `notes`
 * @param {object} [options.normalizer]      catálogo de SmartBC (smartbc-catalogo-cl.mjs)
 */
export function buildCaptacionPayload(bundle, {
  stage = 'assigned',
  includeNotes = true,
  normalizer = PASSTHROUGH,
} = {}) {
  const cap = bundle.captacion
  const comuna = bundle.comuna ?? {}
  const property = bundle.property ?? {}
  const listings = bundle.listings ?? []
  const raw = asObject(cap.raw_extracted)
  const phones = asArray(cap.phones)
  const emails = asArray(cap.emails)
  const relacionados = asArray(cap.relacionados)
  const photos = asArray(cap.photos).filter(isHttpUrl)
  const selected = asArray(cap.selected_photo_urls).filter(isHttpUrl)

  // El anuncio que originó la captación: es de donde salen la corredora, el
  // código interno y la descripción de la ficha principal.
  const principal = listings.find((l) => l.id === cap.listing_cl_id) ?? listings[0] ?? {}
  const storedPhotos = asArray(principal.stored_photos)

  const { price, currency } = pickPrice({
    price: cap.price_raw,
    price_uf: principal.price_uf,
    currency: cap.currency ?? principal.currency,
  })

  const mappedType = mapPropertyType(cap.property_type)
  const contacts = buildContacts({
    captacionId: cap.id,
    ownerName: cap.owner_name,
    ownerRut: cap.owner_rut,
    phones, emails, relacionados,
    seleccion: asArray(cap.smartbc_contactos),
  })
  const photoItems = buildPhotos({ photos, storedPhotos, selectedPhotoUrls: selected })

  const bestPhone = contacts[0]?.phone ?? null
  const ownerContact = [
    cap.owner_rut ? `RUT ${cap.owner_rut}` : null,
    phones.length ? `${phones.length} teléfono${phones.length > 1 ? 's' : ''}` : null,
    emails.length ? `${emails.length} email${emails.length > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ') || null

  const notes = includeNotes ? buildProvenanceNote(cap) : null

  const payload = pruneNulls({
    external_id: externalIdFor(cap.id),

    // ── Ficha ───────────────────────────────────────────────────────────────
    title: trunc(cap.title, LIMITS.title),
    description: trunc(principal.description ?? raw.description, LIMITS.description),
    operation: mapOperation(cap.operation),
    price,
    currency,
    bedrooms: intOrNull(cap.bedrooms),
    bathrooms: intOrNull(cap.bathrooms),
    square_meters: intOrNull(cap.sqm),
    useful_square_meters: intOrNull(raw.sqm_construida),
    property_type: mappedType,
    features: buildFeatures(asArray(principal.features), raw),
    source_url: isHttpUrl(cap.source_url) ? cap.source_url : null,
    source_site: trunc(principal.portal, 100),
    cover_photo_url: photoItems[0]?.url ?? null,
    broker_name: trunc(principal.corredora_name ?? principal.advertiser_name, LIMITS.brokerName),
    external_reference: trunc(principal.seller_reference, LIMITS.externalReference),
    portal_publication_number: publicationNumber(principal.external_id),

    // ── Ubicación ───────────────────────────────────────────────────────────
    // Normalizadas contra el catálogo de SmartBC: lo que no exista allí no
    // viaja (queda en normalizer.faltantes para reportárselo), en vez de
    // colarse como texto libre en un campo del equipo.
    region: trunc(
      normalizer.region(normalizer.regionDeComuna(comuna.name ?? cap.comuna_label) ?? comuna.region),
      120,
    ),
    commune: trunc(normalizer.comuna(comuna.name ?? cap.comuna_label), 120),
    zone: trunc(
      normalizer.zona(comuna.name ?? cap.comuna_label, property.localidad ?? principal.localidad),
      120,
    ),
    address_scraped: trunc(cap.address, LIMITS.addressScraped),
    // Dirección exacta del catastro SII para el rol resuelto: mejor dato que el
    // del aviso. Es campo del equipo — si ya escribieron una, la API la protege.
    address_real: trunc(cap.sii_direccion, LIMITS.addressScraped),
    // Solo se afirma "verificada" cuando la dirección del certificado TGR
    // coincide con la del SII (confirmación documental), nunca por el score.
    address_verified: cap.match_verified === true ? true : null,
    latitude: numOrNull(cap.latitude),
    longitude: numOrNull(cap.longitude),
    // En formato OFICIAL (manzana y predio a cinco dígitos, "03810-00021"), no
    // en el canónico interno. La base guarda el rol sin ceros a la izquierda
    // porque es el formato de sii_roles_cl y con él se cruzan ficha, catastro y
    // caché de TGR (migración 0093) — pero eso es una decisión NUESTRA para
    // comparar. Al CRM va el rol como lo imprime el SII y como sale en el
    // certificado de la Tesorería, que es el que va a teclear quien lo busque.
    rol_propiedad: trunc(formatRolCl(cap.sii_rol), 50),

    // ── Propietario ─────────────────────────────────────────────────────────
    // `confirmed` ausente a propósito: ver CONFIRMED_NOTE.
    owner: pruneNulls({
      name: trunc(cap.owner_name, 200),
      phone: trunc(bestPhone, LIMITS.phone),
      contact: trunc(ownerContact, LIMITS.ownerContact),
    }),
    notes: trunc(notes, LIMITS.notes),

    contacts: contacts.map(pruneNulls),
    photos: photoItems.length ? { mode: 'sync', items: photoItems } : null,
    listings: buildListings(listings, {
      principalId: principal.id ?? null,
      principalTitle: cap.title ?? null,
      principalRaw: raw,
      normalizer,
    }).map(pruneNulls),

    // `attempts` NO se envía, y no es una carencia: los intentos de contacto se
    // registran en SmartBC y solo allí, porque es desde allí desde donde se
    // llama al propietario. -mio identifica al dueño y sus teléfonos; la
    // conversación con él pertenece al CRM.

    stage: stage ?? null,
    // `assigned_to_email` no se envía: SmartBC reparte automáticamente y a quién
    // le toca cada captación es decisión suya.

    metadata: pruneNulls({
      origen: 'casafari-mio',
      captacion_id: cap.id,
      property_cl_id: cap.property_cl_id ?? null,
      listing_cl_id: cap.listing_cl_id ?? null,
      // El rol en formato CANÓNICO INTERNO, a propósito: metadata es la pista
      // de auditoría y es el valor con el que se puede volver a nuestra base.
      // El que se lee en la ficha es `rol_propiedad`, en formato oficial.
      sii_rol: cap.sii_rol ?? null,
      sii_comuna_code: cap.sii_comuna_code ?? null,
      // Auditoría del match que SmartBC no tiene dónde guardar: su ficha tiene
      // `rol_propiedad` pero ningún campo de confianza.
      match_score: numOrNull(cap.match_score),
      match_confidence: cap.match_confidence ?? null,
      match_verified: cap.match_verified === true,
      tgr_status: cap.tgr_status ?? null,
      dealernet_status: cap.dealernet_status ?? null,
      relacionados_total: relacionados.length,
      relacionados_enviados: contacts.length - 1,
      emails_total: emails.length,
      // Solo cuando el tipo no encajó en la lista cerrada: así SmartBC puede ver
      // qué hay detrás de un `other` sin que nosotros inventemos un enum.
      property_type_origen: mappedType === 'other' ? (cap.property_type ?? null) : null,
    }),
  })

  return payload
}

/**
 * Línea de procedencia para `notes` (campo del equipo: solo se escribe si está
 * vacío). Solo datos que le sirven a quien va a llamar — nada de los nombres
 * internos de nuestro pipeline (ni "DealerNet" ni "casafari-mio"): esos viven
 * en `metadata`, que es la pista de auditoría, no la ficha visible.
 */
export function buildProvenanceNote(cap) {
  const partes = []
  if (cap.sii_rol) partes.push(`Rol SII ${cap.sii_rol}`)
  const score = numOrNull(cap.match_score)
  if (score != null) partes.push(`match ${score.toFixed(2)}`)
  if (cap.match_verified === true) partes.push('verificado con certificado TGR')
  if (cap.owner_name && cap.tgr_status === 'ok') partes.push('dueño según TGR')
  return partes.join(' · ')
}

// ─── Diff e idempotencia ─────────────────────────────────────────────────────

/** sha256 estable del payload (claves ordenadas) — detecta "no ha cambiado nada". */
export function payloadHash(payload) {
  return createHash('sha256').update(stableStringify(payload)).digest('hex')
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

/**
 * Diff contra el último payload aceptado: devuelve SOLO los campos que se
 * movieron (más `external_id`, que identifica la ficha).
 *
 * Por qué importa: reenviar la ficha completa para corregir un precio obliga a
 * SmartBC a revalidar contactos, avisos y las 60 fotos de la galería. Con el
 * diff, un cambio de precio es un PATCH de dos claves.
 *
 * Las secciones compuestas (contacts/photos/listings) van enteras o no van: son
 * conjuntos con su propia semántica de sincronización en el servidor (`sync`
 * quita las fotos que ya no mandas), así que un diff parcial dentro de ellas
 * cambiaría el significado del envío.
 */
export function diffPayload(previous, next) {
  if (!previous) return { ...next }
  const patch = { external_id: next.external_id }

  // `source_site` viaja SIEMPRE, cambie o no. Comprobado en vivo: un PATCH que
  // no lo incluye lo sobrescribe con el slug de la integración —
  // "portalinmobiliario" se convierte en "crm-chile"— y se pierde de qué portal
  // salió el aviso. Es el único campo con ese comportamiento (se diffearon las
  // dos fichas completas antes y después de un PATCH mínimo: solo cambiaron
  // price, source_site y los timestamps). Reportado a SmartBC; hasta que lo
  // arreglen, fijarlo aquí es lo que impide que cada cambio de precio corrompa
  // la procedencia del anuncio en su CRM.
  if (next.source_site != null) patch.source_site = next.source_site
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
  for (const key of keys) {
    if (key === 'external_id') continue
    // `stage` solo tiene efecto al crear (después es campo del equipo): no se
    // reenvía en las actualizaciones para no discutirle la etapa al equipo.
    if (key === 'stage') continue
    const a = stableStringify(previous[key] ?? null)
    const b = stableStringify(next[key] ?? null)
    if (a !== b) patch[key] = next[key] ?? null
  }
  return patch
}

/**
 * ¿El diff no tiene nada más que el identificador? Entonces no hay que enviar.
 *
 * `source_site` no cuenta: se añade siempre como escudo (ver diffPayload), no
 * porque haya cambiado. Si contara, cada captación parecería tener cambios
 * eternamente y el "no mandes lo que no cambió" dejaría de funcionar.
 */
export function isEmptyPatch(patch) {
  return Object.keys(patch).filter((k) => k !== 'external_id' && k !== 'source_site').length === 0
}
