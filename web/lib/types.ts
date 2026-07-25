// Tipos de dominio compartidos (anuncios, fuentes, histórico de precios).
// Antes vivían en mock-listings.ts y el código de producción importaba tipos
// desde un archivo de datos de ejemplo.

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
  // Se puebla desde la API (photos_by_source) o se deduce del campo photos del listing
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
  /** 'CLP' (Chile) o ausente = EUR (España, comportamiento histórico). */
  currency?: 'EUR' | 'CLP'
  /** Valor en UF del anuncio chileno, si el portal lo publicó en esa unidad. */
  price_uf?: number | null
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
  photos: string[] // Todas las fotos (union de todas las fuentes)
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
  sources: Source[] // Cada source puede tener su propio array photos[] para filtrado
  // Campos derivados del checklist de publicación de Idealista (se autocompletan en normalizeListings)
  elevator?: boolean
  orientation?: string
  heating?: string
  accessible?: boolean
  is_bank_owned?: boolean
  tenant_profile?: string
  condition?: string
  exterior?: boolean
  /**
   * Chile: propiedad canónica (`property_cl`) a la que pertenece este anuncio.
   * Permite abrir la MISMA ficha del inmueble desde /chile/anuncios que desde
   * /chile/propiedades, en vez de mandar al portal original.
   */
  property_cl_id?: string | null
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

