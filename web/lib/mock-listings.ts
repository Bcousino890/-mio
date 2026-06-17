export type PriceEvent = {
  date: string
  price: number
  event: 'listed' | 'price_drop' | 'price_increase' | 'relisted' | 'withdrawn'
  // Fuente que publicó este evento (se autocompleta en normalizeListings)
  sourceId?: string
}

export type SourceReference = {
  /** Origen de la referencia: el portal donde se publica o "Web propia" del anunciante */
  label: string
  value: string
}

export type Source = {
  id: string
  type: 'particular' | 'agency'
  name: string
  portal: string
  price: number
  status: 'active' | 'withdrawn' | 'sold'
  listed_at: string
  url: string
  // Datos de la ficha "Comercializando" (se autocompletan en normalizeListings)
  reference?: string
  // Un mismo anunciante puede tener varias referencias (su web propia + el portal)
  references?: SourceReference[]
  // Fotos publicadas específicamente por esta fuente (para el selector "Seleccionar fuente de fotos")
  photos?: string[]
  phone?: string
  phone_contacts?: number
  bedrooms?: number
  bathrooms?: number
  built_area?: number
  plot_area?: number
  address?: string
  is_particular?: boolean
}

export type ListingBadge = {
  label: string
  color: 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'orange'
}

export type Listing = {
  id: string
  property_id: string
  title: string
  operation: 'sale' | 'rent'
  price: number
  square_meters: number
  price_sqm: number
  bedrooms: number
  bathrooms: number
  floor?: string
  zone_name: string
  portal: string
  source_type: 'portal' | 'agency_web' | 'own_web' | 'external_web'
  advertiser_type: 'particular' | 'professional'
  advertiser_name: string
  days_on_market: number
  is_active: boolean
  latitude: number
  longitude: number
  photos: string[]
  source_url: string
  listing_count: number
  portals: string[]
  price_drops: number
  rc_status: 'none' | 'rc14' | 'rc20'
  exact_address?: string
  barrio?: string
  distrito?: string
  badge?: ListingBadge
  description?: string
  features?: string[]
  photo_tags?: string[]
  floor_plans?: string[]
  videos?: string[]
  virtual_tours?: string[]
  energy_cert?: EnergyCert
  deposit_months?: number
  stats?: ListingStats
  priceHistory: PriceEvent[]
  sources: Source[]
  // Campos derivados del checklist de publicación de Idealista (se autocompletan en normalizeListings)
  elevator?: boolean
  orientation?: string
  heating?: string
  accessible?: boolean
  is_bank_owned?: boolean
  tenant_profile?: string
  condition?: string
  exterior?: boolean
}

export type EnergyCert = {
  consumption?: string | null
  emissions?: string | null
  image?: string | null
}

export type ListingStats = {
  views?: number | null
  email_contacts?: number | null
  favorites?: number | null
}

const rawListings: Listing[] = [
  {
    id: 'l1', property_id: 'p1',
    title: 'Piso en Calle de Serrano, Salamanca',
    operation: 'sale', price: 1_250_000, square_meters: 120, price_sqm: 10_417,
    bedrooms: 3, bathrooms: 2, floor: '4º', zone_name: 'Barrio Salamanca',
    portal: 'idealista', source_type: 'portal', advertiser_type: 'professional',
    advertiser_name: 'Engel & Völkers Madrid', days_on_market: 22, is_active: true,
    latitude: 40.4268, longitude: -3.6878, source_url: '#',
    photos: ['/photos/image-1781575556522.webp', '/photos/image-1781575561863.webp', '/photos/image-1781575565497.webp'],
    listing_count: 3, portals: ['idealista', 'fotocasa', 'GuinotPrunera'],
    price_drops: 1, rc_status: 'rc14',
    exact_address: 'Calle de Serrano, 45, 4ºB',
    badge: { label: 'Bajada de precio', color: 'green' },
    priceHistory: [
      { date: '2026-01-04', price: 1_350_000, event: 'listed' },
      { date: '2026-02-14', price: 1_300_000, event: 'price_drop' },
      { date: '2026-04-25', price: 1_250_000, event: 'price_drop' },
    ],
    sources: [
      { id: 's1a', type: 'agency', name: 'Engel & Völkers', portal: 'idealista', price: 1_250_000, status: 'active', listed_at: '2026-01-04', url: '#' },
      { id: 's1b', type: 'agency', name: 'Engel & Völkers', portal: 'fotocasa', price: 1_250_000, status: 'active', listed_at: '2026-01-04', url: '#' },
      { id: 's1c', type: 'agency', name: 'GuinotPrunera', portal: 'GuinotPrunera.es', price: 1_280_000, status: 'withdrawn', listed_at: '2026-01-10', url: '#' },
    ],
  },
  {
    id: 'l2', property_id: 'p2',
    title: 'Ático en Calle de Goya, Salamanca',
    operation: 'sale', price: 980_000, square_meters: 95, price_sqm: 10_316,
    bedrooms: 2, bathrooms: 2, floor: 'Ático', zone_name: 'Barrio Salamanca',
    portal: 'fotocasa', source_type: 'portal', advertiser_type: 'particular',
    advertiser_name: 'Particular', days_on_market: 45, is_active: true,
    latitude: 40.4251, longitude: -3.6823, source_url: '#',
    photos: ['/photos/image-1781575569607.webp', '/photos/image-1781575576438.webp'],
    listing_count: 1, portals: ['fotocasa'],
    price_drops: 2, rc_status: 'none',
    badge: { label: 'Particular', color: 'amber' },
    priceHistory: [
      { date: '2026-01-01', price: 1_050_000, event: 'listed' },
      { date: '2026-02-20', price: 1_010_000, event: 'price_drop' },
      { date: '2026-04-01', price: 980_000, event: 'price_drop' },
    ],
    sources: [
      { id: 's2a', type: 'particular', name: 'José M. (propietario)', portal: 'fotocasa', price: 980_000, status: 'active', listed_at: '2026-01-01', url: '#' },
    ],
  },
  {
    id: 'l3', property_id: 'p3',
    title: 'Piso en Calle de Velázquez, Lista',
    operation: 'sale', price: 790_000, square_meters: 88, price_sqm: 8_977,
    bedrooms: 3, bathrooms: 2, floor: '2º', zone_name: 'Barrio Salamanca',
    portal: 'idealista', source_type: 'portal', advertiser_type: 'professional',
    advertiser_name: 'Althena Madrid', days_on_market: 8, is_active: true,
    latitude: 40.4280, longitude: -3.6856, source_url: '#',
    photos: ['/photos/image-1781575580354.webp', '/photos/image-1781575584715.webp'],
    listing_count: 4, portals: ['idealista', 'fotocasa', 'habitaclia', 'pisos.com'],
    price_drops: 0, rc_status: 'none',
    badge: { label: 'Exclusiva rota', color: 'orange' },
    priceHistory: [
      { date: '2026-06-08', price: 790_000, event: 'listed' },
    ],
    sources: [
      { id: 's3a', type: 'agency', name: 'Althena Madrid', portal: 'idealista', price: 790_000, status: 'active', listed_at: '2026-06-08', url: '#' },
      { id: 's3b', type: 'agency', name: 'Prime Salamanca', portal: 'fotocasa', price: 795_000, status: 'active', listed_at: '2026-06-09', url: '#' },
      { id: 's3c', type: 'agency', name: 'Madrid Luxury Homes', portal: 'habitaclia', price: 790_000, status: 'active', listed_at: '2026-06-10', url: '#' },
      { id: 's3d', type: 'agency', name: 'Keystone', portal: 'pisos.com', price: 800_000, status: 'active', listed_at: '2026-06-10', url: '#' },
    ],
  },
  {
    id: 'l4', property_id: 'p4',
    title: 'Dúplex en Calle de Juan Bravo, Recoletos',
    operation: 'sale', price: 1_650_000, square_meters: 210, price_sqm: 7_857,
    bedrooms: 4, bathrooms: 3, floor: '5º-6º', zone_name: 'Barrio Salamanca',
    portal: 'idealista', source_type: 'portal', advertiser_type: 'professional',
    advertiser_name: 'Knight Frank', days_on_market: 63, is_active: true,
    latitude: 40.4312, longitude: -3.6890, source_url: '#',
    photos: ['/photos/image-1781575587981.webp', '/photos/image-1781575590986.webp'],
    listing_count: 2, portals: ['idealista', 'lujo.es'],
    price_drops: 1, rc_status: 'none',
    badge: { label: 'Oportunidad', color: 'green' },
    priceHistory: [
      { date: '2026-01-14', price: 1_800_000, event: 'listed' },
      { date: '2026-03-08', price: 1_650_000, event: 'price_drop' },
    ],
    sources: [
      { id: 's4a', type: 'agency', name: 'Knight Frank', portal: 'idealista', price: 1_650_000, status: 'active', listed_at: '2026-01-14', url: '#' },
      { id: 's4b', type: 'agency', name: 'LuxuryEstate', portal: 'lujo.es', price: 1_690_000, status: 'withdrawn', listed_at: '2026-01-14', url: '#' },
    ],
  },
  {
    id: 'l5', property_id: 'p5',
    title: 'Piso en Calle de Ortega y Gasset',
    operation: 'sale', price: 595_000, square_meters: 68, price_sqm: 8_750,
    bedrooms: 2, bathrooms: 1, floor: '3º', zone_name: 'Barrio Salamanca',
    portal: 'fotocasa', source_type: 'portal', advertiser_type: 'particular',
    advertiser_name: 'Particular', days_on_market: 120, is_active: true,
    latitude: 40.4235, longitude: -3.6901, source_url: '#',
    photos: ['/photos/image-1781575594917.webp', '/photos/image-1781575598054.webp'],
    listing_count: 1, portals: ['fotocasa'],
    price_drops: 3, rc_status: 'none',
    badge: { label: 'Particular', color: 'amber' },
    priceHistory: [
      { date: '2025-12-07', price: 695_000, event: 'listed' },
      { date: '2026-01-05', price: 670_000, event: 'price_drop' },
      { date: '2026-03-02', price: 640_000, event: 'price_drop' },
      { date: '2026-05-20', price: 595_000, event: 'price_drop' },
    ],
    sources: [
      { id: 's5a', type: 'particular', name: 'Ana G. (propietaria)', portal: 'fotocasa', price: 595_000, status: 'active', listed_at: '2025-12-07', url: '#' },
    ],
  },
  {
    id: 'l6', property_id: 'p6',
    title: 'Piso en Calle de Almagro, Chamberí',
    operation: 'sale', price: 680_000, square_meters: 82, price_sqm: 8_293,
    bedrooms: 3, bathrooms: 2, floor: '1º', zone_name: 'Almagro (Chamberí)',
    portal: 'idealista', source_type: 'portal', advertiser_type: 'professional',
    advertiser_name: 'Aedas Homes', days_on_market: 14, is_active: true,
    latitude: 40.4363, longitude: -3.6978, source_url: '#',
    photos: ['/photos/image-1781575601800.webp', '/photos/image-1781575605154.webp'],
    listing_count: 2, portals: ['idealista', 'fotocasa'],
    price_drops: 0, rc_status: 'rc20',
    badge: { label: 'Ubicación exacta', color: 'purple' },
    priceHistory: [
      { date: '2026-06-02', price: 680_000, event: 'listed' },
    ],
    sources: [
      { id: 's6a', type: 'agency', name: 'Aedas Homes', portal: 'idealista', price: 680_000, status: 'active', listed_at: '2026-06-02', url: '#' },
      { id: 's6b', type: 'agency', name: 'Aedas Homes', portal: 'fotocasa', price: 680_000, status: 'active', listed_at: '2026-06-02', url: '#' },
    ],
  },
  {
    id: 'l7', property_id: 'p7',
    title: 'Piso en Calle de Ibiza, Retiro',
    operation: 'sale', price: 485_000, square_meters: 72, price_sqm: 6_736,
    bedrooms: 2, bathrooms: 1, floor: '4º', zone_name: 'Ibiza (Retiro)',
    portal: 'habitaclia', source_type: 'portal', advertiser_type: 'particular',
    advertiser_name: 'Particular', days_on_market: 31, is_active: true,
    latitude: 40.4148, longitude: -3.6748, source_url: '#',
    photos: ['/photos/image-1781575608146.webp', '/photos/image-1781575556522.webp'],
    listing_count: 1, portals: ['habitaclia'],
    price_drops: 1, rc_status: 'none',
    badge: { label: 'Particular', color: 'amber' },
    priceHistory: [
      { date: '2026-04-26', price: 510_000, event: 'listed' },
      { date: '2026-05-30', price: 485_000, event: 'price_drop' },
    ],
    sources: [
      { id: 's7a', type: 'particular', name: 'Propietario (privado)', portal: 'habitaclia', price: 485_000, status: 'active', listed_at: '2026-04-26', url: '#' },
    ],
  },
  {
    id: 'l8', property_id: 'p8',
    title: 'Chalet en Pozuelo de Alarcón',
    operation: 'sale', price: 1_100_000, square_meters: 280, price_sqm: 3_929,
    bedrooms: 5, bathrooms: 4, floor: 'Planta baja', zone_name: 'Pozuelo de Alarcón',
    portal: 'idealista', source_type: 'portal', advertiser_type: 'professional',
    advertiser_name: 'RE/MAX Pozuelo', days_on_market: 48, is_active: true,
    latitude: 40.4350, longitude: -3.8133, source_url: '#',
    photos: ['/photos/image-1781575561863.webp', '/photos/image-1781575565497.webp'],
    listing_count: 3, portals: ['idealista', 'fotocasa', 'remax-pozuelo.es'],
    price_drops: 2, rc_status: 'none',
    badge: { label: 'Bajada de precio', color: 'green' },
    priceHistory: [
      { date: '2026-03-29', price: 1_250_000, event: 'listed' },
      { date: '2026-04-20', price: 1_180_000, event: 'price_drop' },
      { date: '2026-05-15', price: 1_100_000, event: 'price_drop' },
    ],
    sources: [
      { id: 's8a', type: 'agency', name: 'RE/MAX Pozuelo', portal: 'idealista', price: 1_100_000, status: 'active', listed_at: '2026-03-29', url: '#' },
      { id: 's8b', type: 'agency', name: 'RE/MAX Pozuelo', portal: 'fotocasa', price: 1_100_000, status: 'active', listed_at: '2026-03-29', url: '#' },
      { id: 's8c', type: 'agency', name: 'Pozuelo Homes', portal: 'remax-pozuelo.es', price: 1_120_000, status: 'withdrawn', listed_at: '2026-04-01', url: '#' },
    ],
  },
  {
    id: 'l9', property_id: 'p9',
    title: 'Villa en La Moraleja, Alcobendas',
    operation: 'sale', price: 2_800_000, square_meters: 450, price_sqm: 6_222,
    bedrooms: 6, bathrooms: 5, floor: 'Planta baja', zone_name: 'La Moraleja (Alcobendas)',
    portal: 'idealista', source_type: 'portal', advertiser_type: 'professional',
    advertiser_name: "Sotheby's International",days_on_market: 90, is_active: true,
    latitude: 40.5060, longitude: -3.6530, source_url: '#',
    photos: ['/photos/image-1781575576438.webp', '/photos/image-1781575580354.webp'],
    listing_count: 2, portals: ['idealista', 'sothebysrealty.es'],
    price_drops: 1, rc_status: 'none',
    badge: { label: 'Lujo', color: 'purple' },
    priceHistory: [
      { date: '2025-12-17', price: 3_100_000, event: 'listed' },
      { date: '2026-03-10', price: 2_800_000, event: 'price_drop' },
    ],
    sources: [
      { id: 's9a', type: 'agency', name: "Sotheby's International", portal: 'idealista', price: 2_800_000, status: 'active', listed_at: '2025-12-17', url: '#' },
      { id: 's9b', type: 'agency', name: "Sotheby's Spain", portal: 'sothebysrealty.es', price: 2_850_000, status: 'active', listed_at: '2025-12-17', url: '#' },
    ],
  },
  {
    id: 'l10', property_id: 'p10',
    title: 'Estudio en Calle de Lagasca, Salamanca',
    operation: 'rent', price: 1_400, square_meters: 42, price_sqm: 33,
    bedrooms: 0, bathrooms: 1, floor: '2º', zone_name: 'Barrio Salamanca',
    portal: 'fotocasa', source_type: 'portal', advertiser_type: 'particular',
    advertiser_name: 'Particular', days_on_market: 5, is_active: true,
    latitude: 40.4290, longitude: -3.6864, source_url: '#',
    photos: ['/photos/image-1781575584715.webp', '/photos/image-1781575587981.webp'],
    listing_count: 1, portals: ['fotocasa'],
    price_drops: 0, rc_status: 'none',
    badge: { label: 'Particular', color: 'amber' },
    priceHistory: [
      { date: '2026-06-11', price: 1_400, event: 'listed' },
    ],
    sources: [
      { id: 's10a', type: 'particular', name: 'Propietario (privado)', portal: 'fotocasa', price: 1_400, status: 'active', listed_at: '2026-06-11', url: '#' },
    ],
  },
]

// ── Normalización ────────────────────────────────────────────────────────────
// Rellena los campos de la ficha "Comercializando" de cada fuente de forma
// determinista cuando no vienen explícitos, para que la tabla se vea completa.
function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function genReference(src: Source): string {
  const h = hashStr(src.id + src.portal)
  const prefixes = ['REF', 'MV', 'CB', 'ID', 'AG']
  const prefix = prefixes[h % prefixes.length]
  return `${prefix}${(h % 9_000_000 + 1_000_000)}`
}

function genReferences(src: Source, portalReference: string): SourceReference[] {
  const portalLabel = src.portal.charAt(0).toUpperCase() + src.portal.slice(1)
  const h = hashStr(src.id + src.name + 'own-ref')
  const ownReference = `${(h % 900_000 + 100_000)}`
  return [
    { label: portalLabel, value: portalReference },
    { label: 'Web propia', value: ownReference },
  ]
}

function genSourcePhotos(src: Source, allPhotos: string[]): string[] {
  if (allPhotos.length === 0) return []
  const h = hashStr(src.id + 'photos')
  const count = Math.max(Math.min(allPhotos.length, 3), allPhotos.length - (h % Math.min(4, allPhotos.length)))
  const offset = h % allPhotos.length
  const rotated = [...allPhotos.slice(offset), ...allPhotos.slice(0, offset)]
  return rotated.slice(0, count)
}

function parseElevator(features?: string[]): boolean | undefined {
  if (!features) return undefined
  if (features.some((f) => /con ascensor/i.test(f))) return true
  if (features.some((f) => /sin ascensor/i.test(f))) return false
  return undefined
}

function parseOrientation(features?: string[]): string | undefined {
  const f = features?.find((ft) => /orientaci[oó]n/i.test(ft))
  if (!f) return undefined
  const dirs = f.replace(/orientaci[oó]n\s*/i, '').split(/,\s*/).filter(Boolean)
  if (dirs.length === 0) return undefined
  return dirs.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')
}

function parseHeating(features?: string[]): string | undefined {
  const f = features?.find((ft) => /calefacci[oó]n/i.test(ft))
  if (!f) return undefined
  const rest = f.replace(/^calefacci[oó]n\s*:?\s*/i, '').trim()
  if (!rest) return 'Sí'
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

function parseAccessible(features?: string[]): boolean | undefined {
  if (!features) return undefined
  if (features.some((f) => /movilidad reducida/i.test(f))) return true
  return undefined
}

function parseCondition(features?: string[]): string | undefined {
  const f = features?.find((ft) => /segunda mano|nueva construcci[oó]n|a estrenar/i.test(ft))
  if (!f) return undefined
  if (/para reformar/i.test(f)) return 'A reformar'
  if (/buen estado/i.test(f)) return 'Buen estado'
  if (/a estrenar|nueva construcci[oó]n/i.test(f)) return 'A estrenar'
  return f
}

function parseExterior(floor?: string): boolean | undefined {
  if (!floor) return undefined
  if (/exterior/i.test(floor)) return true
  if (/interior/i.test(floor)) return false
  return undefined
}

// Solo se marca cuando el texto scrapeado lo indica explícitamente: no se inventa la categoría.
function parseBankOwned(features?: string[], description?: string): boolean | undefined {
  const text = `${description ?? ''} ${(features ?? []).join(' ')}`
  if (/inmueble de banco|vivienda de banco|piso de banco|procedente de (un )?banco/i.test(text)) return true
  return undefined
}

// Heurística conservadora: solo etiqueta cuando el anuncio lo dice explícitamente,
// para no atribuir restricciones de inquilino que no vienen del anunciante.
function parseTenantProfile(operation: string, description?: string): string | undefined {
  if (operation !== 'rent' || !description) return undefined
  if (/no\s+estudiantes/i.test(description)) return 'No estudiantes'
  if (/s[oó]lo\s+inquilinos?\s+con\s+n[oó]mina|requiere\s+n[oó]mina/i.test(description)) return 'Requiere nómina'
  if (/estudiantes/i.test(description)) return 'Estudiantes bienvenidos'
  return undefined
}

function genPhone(src: Source): string {
  const h = hashStr(src.id + src.name)
  const isMobile = h % 2 === 0
  const lead = isMobile ? 6 : 9
  const d = (n: number) => String(h % n).padStart(2, '0')
  return `+34 ${lead}${(h % 90 + 10)} ${d(90) } ${d(80)} ${d(70)}`
}

function normalizeListings(listings: Listing[]): Listing[] {
  return listings.map((l) => {
    const sources = l.sources.map((s) => {
      const reference = s.reference ?? genReference(s)
      return {
        ...s,
        reference,
        references: s.references ?? genReferences(s, reference),
        photos: s.photos ?? genSourcePhotos(s, l.photos),
        phone: s.phone ?? genPhone(s),
        phone_contacts: s.phone_contacts ?? (hashStr(s.id) % 4),
        bedrooms: s.bedrooms ?? l.bedrooms,
        bathrooms: s.bathrooms ?? l.bathrooms,
        built_area: s.built_area ?? l.square_meters,
        plot_area: s.plot_area,
        address: s.address ?? l.exact_address ?? l.zone_name,
        is_particular: s.is_particular ?? (s.type === 'particular'),
      }
    })
    const priceHistory = l.priceHistory.map((e, i) => ({
      ...e,
      sourceId: e.sourceId ?? sources[hashStr(l.id + e.date + String(i)) % sources.length]?.id,
    }))
    return {
      ...l,
      sources,
      priceHistory,
      elevator: l.elevator ?? parseElevator(l.features),
      orientation: l.orientation ?? parseOrientation(l.features),
      heating: l.heating ?? parseHeating(l.features),
      accessible: l.accessible ?? parseAccessible(l.features),
      condition: l.condition ?? parseCondition(l.features),
      exterior: l.exterior ?? parseExterior(l.floor),
      is_bank_owned: l.is_bank_owned ?? parseBankOwned(l.features, l.description),
      tenant_profile: l.tenant_profile ?? parseTenantProfile(l.operation, l.description),
    }
  })
}

// Datos REALES scrapeados de Idealista (empezando por Goya). Si el fichero está
// vacío se cae a los datos de ejemplo para no romper la UI en desarrollo.
import goyaSample from './listings-goya.json'
import goyaFull from './listings-goya-full.json'

const realListings = (goyaFull.length > goyaSample.length ? goyaFull : goyaSample) as unknown as Listing[]

export const mockListings: Listing[] = normalizeListings(
  realListings.length > 0 ? realListings : rawListings,
)
