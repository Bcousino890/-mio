// ─────────────────────────────────────────────────────────────────────────────
// Transforma una fila scrapeada (parseDetailPage) al tipo `Listing` que consume
// la web (web/lib/mock-listings.ts). Permite alimentar la plataforma con datos
// reales de Idealista manteniendo el mismo contrato de la UI.
// ─────────────────────────────────────────────────────────────────────────────

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
