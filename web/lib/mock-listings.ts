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
  photo_url?: string
  source_url: string
  listing_count: number        // cuántos anuncios agrupa esta propiedad
  portals: string[]            // fuentes donde aparece
  price_drops: number
  rc_status: 'none' | 'rc14' | 'rc20'
  exact_address?: string
}

export const mockListings: Listing[] = [
  {
    id: 'l1', property_id: 'p1',
    title: 'Piso en Calle de Serrano, Salamanca',
    operation: 'sale', price: 1_250_000, square_meters: 120, price_sqm: 10_417,
    bedrooms: 3, bathrooms: 2, floor: '4º', zone_name: 'Barrio Salamanca',
    portal: 'idealista', source_type: 'portal', advertiser_type: 'professional',
    advertiser_name: 'Engel & Völkers Madrid', days_on_market: 22, is_active: true,
    latitude: 40.4268, longitude: -3.6878, source_url: '#',
    listing_count: 3, portals: ['idealista', 'fotocasa', 'GuinotPrunera'],
    price_drops: 1, rc_status: 'rc14',
    exact_address: 'Calle de Serrano, 45, 4ºB',
  },
  {
    id: 'l2', property_id: 'p2',
    title: 'Ático en Calle de Goya, Salamanca',
    operation: 'sale', price: 980_000, square_meters: 95, price_sqm: 10_316,
    bedrooms: 2, bathrooms: 2, floor: 'Ático', zone_name: 'Barrio Salamanca',
    portal: 'fotocasa', source_type: 'portal', advertiser_type: 'particular',
    advertiser_name: 'Particular', days_on_market: 45, is_active: true,
    latitude: 40.4251, longitude: -3.6823, source_url: '#',
    listing_count: 1, portals: ['fotocasa'],
    price_drops: 2, rc_status: 'none',
  },
  {
    id: 'l3', property_id: 'p3',
    title: 'Piso en Calle de Velázquez, Lista',
    operation: 'sale', price: 790_000, square_meters: 88, price_sqm: 8_977,
    bedrooms: 3, bathrooms: 2, floor: '2º', zone_name: 'Barrio Salamanca',
    portal: 'idealista', source_type: 'portal', advertiser_type: 'professional',
    advertiser_name: 'Althena Madrid', days_on_market: 8, is_active: true,
    latitude: 40.4280, longitude: -3.6856, source_url: '#',
    listing_count: 4, portals: ['idealista', 'fotocasa', 'habitaclia', 'pisos.com'],
    price_drops: 0, rc_status: 'none',
  },
  {
    id: 'l4', property_id: 'p4',
    title: 'Dúplex en Calle de Juan Bravo, Recoletos',
    operation: 'sale', price: 1_650_000, square_meters: 210, price_sqm: 7_857,
    bedrooms: 4, bathrooms: 3, floor: '5º-6º', zone_name: 'Barrio Salamanca',
    portal: 'idealista', source_type: 'portal', advertiser_type: 'professional',
    advertiser_name: 'Knight Frank', days_on_market: 63, is_active: true,
    latitude: 40.4312, longitude: -3.6890, source_url: '#',
    listing_count: 2, portals: ['idealista', 'lujo.es'],
    price_drops: 1, rc_status: 'none',
  },
  {
    id: 'l5', property_id: 'p5',
    title: 'Piso en Calle de Ortega y Gasset',
    operation: 'sale', price: 595_000, square_meters: 68, price_sqm: 8_750,
    bedrooms: 2, bathrooms: 1, floor: '3º', zone_name: 'Barrio Salamanca',
    portal: 'fotocasa', source_type: 'portal', advertiser_type: 'particular',
    advertiser_name: 'Particular', days_on_market: 120, is_active: true,
    latitude: 40.4235, longitude: -3.6901, source_url: '#',
    listing_count: 1, portals: ['fotocasa'],
    price_drops: 3, rc_status: 'none',
  },
  {
    id: 'l6', property_id: 'p6',
    title: 'Piso en Calle de Almagro, Chamberí',
    operation: 'sale', price: 680_000, square_meters: 82, price_sqm: 8_293,
    bedrooms: 3, bathrooms: 2, floor: '1º', zone_name: 'Almagro (Chamberí)',
    portal: 'idealista', source_type: 'portal', advertiser_type: 'professional',
    advertiser_name: 'Aedas Homes', days_on_market: 14, is_active: true,
    latitude: 40.4363, longitude: -3.6978, source_url: '#',
    listing_count: 2, portals: ['idealista', 'fotocasa'],
    price_drops: 0, rc_status: 'none',
  },
  {
    id: 'l7', property_id: 'p7',
    title: 'Piso en Calle de Ibiza, Retiro',
    operation: 'sale', price: 485_000, square_meters: 72, price_sqm: 6_736,
    bedrooms: 2, bathrooms: 1, floor: '4º', zone_name: 'Ibiza (Retiro)',
    portal: 'habitaclia', source_type: 'portal', advertiser_type: 'particular',
    advertiser_name: 'Particular', days_on_market: 31, is_active: true,
    latitude: 40.4148, longitude: -3.6748, source_url: '#',
    listing_count: 1, portals: ['habitaclia'],
    price_drops: 1, rc_status: 'none',
  },
  {
    id: 'l8', property_id: 'p8',
    title: 'Chalet en Pozuelo de Alarcón',
    operation: 'sale', price: 1_100_000, square_meters: 280, price_sqm: 3_929,
    bedrooms: 5, bathrooms: 4, floor: 'Planta baja', zone_name: 'Pozuelo de Alarcón',
    portal: 'idealista', source_type: 'portal', advertiser_type: 'professional',
    advertiser_name: 'RE/MAX Pozuelo', days_on_market: 48, is_active: true,
    latitude: 40.4350, longitude: -3.8133, source_url: '#',
    listing_count: 3, portals: ['idealista', 'fotocasa', 'remax-pozuelo.es'],
    price_drops: 2, rc_status: 'none',
  },
  {
    id: 'l9', property_id: 'p9',
    title: 'Villa en La Moraleja, Alcobendas',
    operation: 'sale', price: 2_800_000, square_meters: 450, price_sqm: 6_222,
    bedrooms: 6, bathrooms: 5, floor: 'Planta baja', zone_name: 'La Moraleja (Alcobendas)',
    portal: 'idealista', source_type: 'portal', advertiser_type: 'professional',
    advertiser_name: 'Sotheby\'s International', days_on_market: 90, is_active: true,
    latitude: 40.5060, longitude: -3.6530, source_url: '#',
    listing_count: 2, portals: ['idealista', 'sothebysrealty.es'],
    price_drops: 1, rc_status: 'none',
  },
  {
    id: 'l10', property_id: 'p10',
    title: 'Estudio en Calle de Lagasca, Salamanca',
    operation: 'rent', price: 1_400, square_meters: 42, price_sqm: 33,
    bedrooms: 0, bathrooms: 1, floor: '2º', zone_name: 'Barrio Salamanca',
    portal: 'fotocasa', source_type: 'portal', advertiser_type: 'particular',
    advertiser_name: 'Particular', days_on_market: 5, is_active: true,
    latitude: 40.4290, longitude: -3.6864, source_url: '#',
    listing_count: 1, portals: ['fotocasa'],
    price_drops: 0, rc_status: 'none',
  },
]
