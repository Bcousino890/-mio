// ─────────────────────────────────────────────────────────────────────────────
// Transforma una fila scrapeada (parseDetailPage) al tipo `Listing` que consume
// la web (web/lib/mock-listings.ts). Permite alimentar la plataforma con datos
// reales de Idealista manteniendo el mismo contrato de la UI.
//
// `toAppListingCl` (más abajo) es el equivalente para Chile/Portalinmobiliario:
// mismo contrato de salida, pero con moneda dual UF/CLP, comuna normalizada
// (vía chile-comunas.mjs) y `location_confidence` en vez de `rc_status` fijo
// — ver cabecera de esa función para el detalle.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeComuna } from './chile-comunas.mjs'

function zoneName(slug) {
  // madrid/barrio-de-salamanca/goya → "Goya (Salamanca)"
  const parts = slug.split('/')
  const last = parts[parts.length - 1].replace(/-/g, ' ')
  const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase())
  const distrito = parts.length > 1
    ? cap(parts[parts.length - 2].replace(/^barrio-de-/, '').replace(/-/g, ' '))
    : null
  return distrito ? `${cap(last)} (${distrito})` : cap(last)
}

export function toAppListing(row, { zoneSlug, today = new Date().toISOString().slice(0, 10) } = {}) {
  const isParticular = row.advertiser_type === 'particular'
  const price = row.price ?? 0
  const sqm = row.square_meters ?? 0
  const priceSqm = row.price_sqm ?? (sqm > 0 ? Math.round(price / sqm) : 0)
  const listedDate = (() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - (row.days_on_market ?? 0))
    return d.toISOString().slice(0, 10)
  })()

  const badge = isParticular
    ? { label: 'Particular', color: 'amber' }
    : undefined

  return {
    id: row.external_id,
    property_id: row.external_id,
    title: (row.title ?? '')
      .replace(/\s*[—–-]\s*idealista.*$/i, '')
      .replace(/^(?:alquiler|venta)\s+de\s+\w+\s+en\s+/i, '')
      .trim() || `Inmueble ${row.external_id}`,
    operation: row.operation,
    price,
    square_meters: sqm,
    price_sqm: priceSqm,
    bedrooms: row.bedrooms ?? 0,
    bathrooms: row.bathrooms ?? 1,
    floor: (row.features ?? []).find((f) => /planta|bajo|entreplanta/i.test(f)) ?? undefined,
    zone_name: zoneName(zoneSlug),
    portal: 'idealista',
    source_type: 'portal',
    advertiser_type: isParticular ? 'particular' : 'professional',
    advertiser_name: row.advertiser_name ?? 'Idealista',
    days_on_market: row.days_on_market ?? 0,
    is_active: true,
    latitude: row.latitude ?? 40.43,
    longitude: row.longitude ?? -3.68,
    photos: row.photos ?? [],
    source_url: row.source_url,
    listing_count: 1,
    portals: ['idealista'],
    price_drops: 0,
    rc_status: 'none',
    exact_address: row.exact_address ?? undefined,   // solo particulares: calle + nº
    barrio: row.barrio ?? undefined,
    distrito: row.distrito ?? undefined,
    badge,
    description: row.description ?? undefined,
    features: row.features ?? [],
    photo_tags: row.photo_tags ?? [],
    floor_plans: row.floor_plans ?? [],
    videos: row.videos ?? [],
    virtual_tours: row.virtual_tours ?? [],
    energy_cert: row.energy_cert ?? undefined,
    deposit_months: row.deposit_months ?? undefined,
    stats: row.stats ?? undefined,
    priceHistory: [
      { date: listedDate, price, event: 'listed' },
    ],
    sources: [
      {
        id: `${row.external_id}-idealista`,
        type: isParticular ? 'particular' : 'agency',
        name: row.advertiser_name ?? 'Idealista',
        portal: 'idealista',
        price,
        status: 'active',
        listed_at: listedDate,
        url: row.source_url,
        reference: row.reference ?? undefined,
        phone: row.phone ?? undefined,
        bedrooms: row.bedrooms ?? undefined,
        bathrooms: row.bathrooms ?? undefined,
        built_area: row.square_meters ?? undefined,
        address: row.exact_address ?? row.address ?? undefined,
        is_particular: isParticular,
      },
    ],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// toAppListingCl — equivalente de toAppListing para el módulo Chile
// (Portalinmobiliario). Mismo contrato de salida (tipo `Listing`), con tres
// diferencias respecto a España:
//
// 1. Moneda dual UF/CLP: Portalinmobiliario publica precios indistintamente
//    en UF (Unidad de Fomento, indexada a inflación) o CLP. Esta función
//    acepta `row.price_clp` ya resuelto a CLP (preferido, si el caller ya
//    hizo la conversión) o, si no viene, usa `row.price_uf` + `opts.ufRate`
//    (CLP por 1 UF) para calcularlo. `opts.ufRate`/`opts.ufRateDate` deben
//    venir resueltos por el caller — esta función NO hace I/O a propósito
//    (sigue siendo una función pura de mapeo), pero el lookup real ya existe:
//    `scraper/lib/uf-rate-cl.mjs::getUfRateCl()` consulta mindicador.cl
//    (serie UF oficial del Banco Central de Chile, republicada por una API
//    pública pensada para consumo programático) y cachea la tasa en memoria
//    para que una corrida completa del scraper haga como máximo una petición
//    de red en vez de una por anuncio. `scrape-multi-portal.mjs` es quien la
//    llama y pasa el resultado aquí. Se persiste también `uf_rate_date` (la
//    fecha de la serie usada, no necesariamente "hoy" si la API aún no
//    publicó el valor del día) porque la UF cambia día a día y comparar
//    precios de anuncios de distintas fechas con una tasa fija sesgaría
//    cualquier análisis histórico.
// 2. `comuna` normalizada vía `chile-comunas.mjs::normalizeComuna` en vez de
//    barrio/distrito españoles.
// 3. `location_confidence: 'none'` en vez de `rc_status: 'none'` directo: en
//    España la dirección de un particular ya es confiable y `rc_status`
//    arranca en 'none' à secas; en Chile el pin/dirección declarado por el
//    vendedor NO es confiable per se (ver research, sección de resolución de
//    identidad) y requiere triangulación posterior. `location_confidence` es
//    el campo que ese motor (fuera del alcance de este archivo) irá
//    actualizando ('none' → 'candidate' → 'pin_suspect' → 'confirmed', según
//    el apéndice del research) — placeholder 'none' aquí.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resuelve el precio en CLP de una fila scrapeada. `parseDetailPage` entrega
 * `price`+`currency` (no `price_clp`/`price_uf` separados); si la fila ya
 * trae esos campos explícitos se respetan, si no se derivan de `currency`.
 * Devuelve null si no hay suficiente información (anuncio en UF sin tasa).
 */
function resolvePriceClp(row, ufRate) {
  if (row.price_clp != null) return Math.round(row.price_clp)
  if (row.price_uf != null && ufRate != null) return Math.round(row.price_uf * ufRate)
  if (row.price != null) {
    if (row.currency === 'UF') return ufRate != null ? Math.round(row.price * ufRate) : null
    return Math.round(row.price)
  }
  return null
}

function resolvePriceUf(row) {
  if (row.price_uf != null) return row.price_uf
  return row.currency === 'UF' ? row.price ?? null : null
}

export function toAppListingCl(row, { zoneSlug, ufRate, ufRateDate, today = new Date().toISOString().slice(0, 10) } = {}) {
  const isParticular = row.advertiser_type === 'particular'
  const price = resolvePriceClp(row, ufRate) ?? 0
  const sqm = row.square_meters ?? 0
  const priceSqm = row.price_sqm ?? (sqm > 0 ? Math.round(price / sqm) : 0)
  const listedDate = (() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - (row.days_on_market ?? 0))
    return d.toISOString().slice(0, 10)
  })()

  const { comuna, localidad } = normalizeComuna(row.comuna ?? row.address ?? zoneSlug)
  const comunaName = comuna?.name ?? row.comuna ?? null

  const badge = isParticular
    ? { label: 'Particular', color: 'amber' }
    : undefined

  return {
    id: row.external_id,
    property_id: row.external_id,
    title: (row.title ?? '')
      .replace(/\s*[|-]\s*Portalinmobiliario.*$/i, '')
      .trim() || `Inmueble ${row.external_id}`,
    operation: row.operation,
    property_type: row.property_type ?? null,
    price,
    price_uf: resolvePriceUf(row),
    uf_rate: ufRate ?? null,
    // Fecha de la serie UF usada para la conversión (ver getUfRateCl en
    // uf-rate-cl.mjs) — null si no se necesitó conversión (anuncio ya en CLP).
    uf_rate_date: ufRateDate ?? null,
    currency: row.currency ?? 'CLP',
    square_meters: sqm,
    price_sqm: priceSqm,
    bedrooms: row.bedrooms ?? 0,
    bathrooms: row.bathrooms ?? 1,
    zone_name: comunaName ?? zoneName_fallback(zoneSlug),
    portal: 'portalinmobiliario',
    source_type: 'portal',
    advertiser_type: isParticular ? 'particular' : 'professional',
    advertiser_name: row.advertiser_name ?? 'Portalinmobiliario',
    days_on_market: row.days_on_market ?? 0,
    is_active: true,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    photos: row.photos ?? [],
    source_url: row.source_url,
    listing_count: 1,
    portals: ['portalinmobiliario'],
    price_drops: 0,
    // location_confidence en vez de rc_status: el pin/dirección declarado por
    // el vendedor en Portalinmobiliario no es confiable por sí solo (ver
    // comentario de cabecera) — placeholder hasta que el motor de
    // triangulación lo actualice.
    location_confidence: 'none',
    comuna: comunaName ?? undefined,
    localidad: localidad ?? undefined,
    exact_address: row.exact_address ?? undefined,
    address: row.address ?? undefined,
    badge,
    description: row.description ?? undefined,
    features: row.features ?? [],
    photo_tags: row.photo_tags ?? [],
    floor_plans: row.floor_plans ?? [],
    videos: row.videos ?? [],
    virtual_tours: row.virtual_tours ?? [],
    priceHistory: [
      { date: listedDate, price, event: 'listed' },
    ],
    sources: [
      {
        id: `${row.external_id}-portalinmobiliario`,
        type: isParticular ? 'particular' : 'agency',
        name: row.advertiser_name ?? 'Portalinmobiliario',
        portal: 'portalinmobiliario',
        price,
        status: 'active',
        listed_at: listedDate,
        url: row.source_url,
        reference: row.reference ?? undefined,
        phone: row.phone ?? undefined,
        bedrooms: row.bedrooms ?? undefined,
        bathrooms: row.bathrooms ?? undefined,
        built_area: row.square_meters ?? undefined,
        address: row.exact_address ?? row.address ?? undefined,
        is_particular: isParticular,
      },
    ],
  }
}

// Fallback de nombre de zona cuando la comuna no se pudo normalizar (ej. el
// scraper aún no reconoce esa comuna en chile-comunas.mjs). Mantiene algo
// legible en vez de undefined.
function zoneName_fallback(slug) {
  if (!slug) return 'Chile'
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
