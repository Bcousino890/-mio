/**
 * Datos de demostración para el visor de catastro de Chile (mapa satelital +
 * polígonos catastrales + pines de anuncios). NO son datos reales — el
 * scraper de Portalinmobiliario y la ingesta de IDE Chile (cadastre-cl.mjs)
 * todavía no están conectados a una base de datos en vivo. Esta forma de
 * datos es la misma que producirán esas dos piezas una vez integradas:
 * - parcels: filas de `cadastre_parcels_cl` (geom como GeoJSON Polygon).
 * - listings: filas de `property_rc_cl` + el listing normalizado
 *   (toAppListingCl), con location_confidence ya resuelto.
 */

export type CadastreParcel = {
  id: string
  comuna: string
  rol: string | null
  source: 'ide_chile' | 'manual' | 'estimated'
  /** Polígono en GeoJSON, lng/lat (orden estándar GeoJSON). */
  geojson: GeoJSON.Polygon
  centroid: { lat: number; lng: number }
}

export type CadastreListingPin = {
  id: string
  title: string
  comuna: string
  lat: number
  lng: number
  location_confidence: 'none' | 'candidate' | 'pin_suspect' | 'confirmed'
  rol_matriz: string | null
  matched_parcel_id: string | null
  agency_count: number
}

// Vitacura: casa de barrio alto. 6 corredoras republicando el mismo inmueble
// con pines ligeramente distintos → la triangulación + el polígono catastral
// resuelven cuál es la parcela real.
export const MOCK_PARCELS: CadastreParcel[] = [
  {
    id: 'parcel-vitacura-1',
    comuna: 'Vitacura',
    rol: '1234-56',
    source: 'ide_chile',
    centroid: { lat: -33.3895, lng: -70.5979 },
    geojson: {
      type: 'Polygon',
      coordinates: [[
        [-70.5983, -33.3892],
        [-70.5975, -33.3892],
        [-70.5975, -33.3898],
        [-70.5983, -33.3898],
        [-70.5983, -33.3892],
      ]],
    },
  },
  // Zapallar: casa de veraneo con piscina — candidata a usar la señal aérea.
  {
    id: 'parcel-zapallar-1',
    comuna: 'Zapallar',
    rol: '88-4',
    source: 'ide_chile',
    centroid: { lat: -32.5538, lng: -71.4633 },
    geojson: {
      type: 'Polygon',
      coordinates: [[
        [-71.4638, -32.5535],
        [-71.4628, -32.5535],
        [-71.4628, -32.5542],
        [-71.4638, -32.5542],
        [-71.4638, -32.5535],
      ]],
    },
  },
]

export const MOCK_LISTING_PINS: CadastreListingPin[] = [
  // 3 de las 6 corredoras que publican la misma casa de Vitacura, cada una
  // con un pin levemente distinto (m²/dormitorios también distintos entre
  // sí, no representado aquí porque este mock es solo del mapa).
  {
    id: 'mlc-1001',
    title: 'Casa Vitacura · Corredora A',
    comuna: 'Vitacura',
    lat: -33.3893,
    lng: -70.5981,
    location_confidence: 'confirmed',
    rol_matriz: '1234-56',
    matched_parcel_id: 'parcel-vitacura-1',
    agency_count: 6,
  },
  {
    id: 'mlc-1002',
    title: 'Casa Vitacura · Corredora B',
    comuna: 'Vitacura',
    lat: -33.3898,
    lng: -70.5977,
    location_confidence: 'confirmed',
    rol_matriz: '1234-56',
    matched_parcel_id: 'parcel-vitacura-1',
    agency_count: 6,
  },
  {
    id: 'mlc-1003',
    title: 'Casa Vitacura · Corredora C (pin sospechoso)',
    comuna: 'Vitacura',
    lat: -33.4,
    lng: -70.6,
    location_confidence: 'pin_suspect',
    rol_matriz: null,
    matched_parcel_id: null,
    agency_count: 6,
  },
  {
    id: 'mlc-2001',
    title: 'Casa con piscina · Zapallar',
    comuna: 'Zapallar',
    lat: -32.5539,
    lng: -71.4634,
    location_confidence: 'confirmed',
    rol_matriz: '88-4',
    matched_parcel_id: 'parcel-zapallar-1',
    agency_count: 2,
  },
  {
    id: 'mlc-2002',
    title: 'Departamento referencial · Las Condes',
    comuna: 'Las Condes',
    lat: -33.4095,
    lng: -70.5677,
    location_confidence: 'candidate',
    rol_matriz: null,
    matched_parcel_id: null,
    agency_count: 1,
  },
]
