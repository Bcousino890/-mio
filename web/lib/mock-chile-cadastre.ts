/**
 * Datos de demostración para el visor de catastro de Chile (mapa satelital +
 * polígonos catastrales + pines de anuncios). NO son datos reales — el
 * scraper de Portalinmobiliario y la ingesta de IDE Chile (cadastre-cl.mjs)
 * todavía no están conectados a una base de datos en vivo. Esta forma de
 * datos es la misma que producirán esas dos piezas una vez integradas:
 * - parcels: filas de `cadastre_parcels_cl` (geom como GeoJSON Polygon).
 * - listings: filas de `property_rc_cl` + el listing normalizado
 *   (toAppListingCl), con location_confidence ya resuelto.
 *
 * Comunas cubiertas: todas las prioritarias del módulo Chile
 * (barrio alto RM + zonas de vacaciones de alto valor).
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

/** Crea un polígono rectangular centrado en [lat, lng] con tamaño dx/dy en grados. */
function rect(lat: number, lng: number, dy = 0.0006, dx = 0.0008): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: [[
      [lng - dx, lat - dy],
      [lng + dx, lat - dy],
      [lng + dx, lat + dy],
      [lng - dx, lat + dy],
      [lng - dx, lat - dy],
    ]],
  }
}

export const MOCK_PARCELS: CadastreParcel[] = [
  // ── VITACURA ──────────────────────────────────────────────────────────────
  {
    id: 'parcel-vitacura-1',
    comuna: 'Vitacura',
    rol: '1234-56',
    source: 'ide_chile',
    centroid: { lat: -33.3895, lng: -70.5979 },
    geojson: rect(-33.3895, -70.5979),
  },
  {
    id: 'parcel-vitacura-2',
    comuna: 'Vitacura',
    rol: '1235-10',
    source: 'ide_chile',
    centroid: { lat: -33.3870, lng: -70.5950 },
    geojson: rect(-33.3870, -70.5950),
  },

  // ── LAS CONDES ────────────────────────────────────────────────────────────
  {
    id: 'parcel-lascondes-1',
    comuna: 'Las Condes',
    rol: '5501-22',
    source: 'ide_chile',
    centroid: { lat: -33.4095, lng: -70.5677 },
    geojson: rect(-33.4095, -70.5677),
  },
  {
    id: 'parcel-lascondes-2',
    comuna: 'Las Condes',
    rol: '5502-08',
    source: 'ide_chile',
    centroid: { lat: -33.4120, lng: -70.5640 },
    geojson: rect(-33.4120, -70.5640),
  },
  {
    id: 'parcel-lascondes-3',
    comuna: 'Las Condes',
    rol: '5503-14',
    source: 'estimated',
    centroid: { lat: -33.4060, lng: -70.5710 },
    geojson: rect(-33.4060, -70.5710, 0.0005, 0.0007),
  },

  // ── LO BARNECHEA ──────────────────────────────────────────────────────────
  {
    id: 'parcel-lobarnechea-1',
    comuna: 'Lo Barnechea',
    rol: '7710-01',
    source: 'ide_chile',
    centroid: { lat: -33.3504, lng: -70.5167 },
    geojson: rect(-33.3504, -70.5167, 0.0007, 0.0009),
  },
  {
    id: 'parcel-lobarnechea-2',
    comuna: 'Lo Barnechea',
    rol: '7711-33',
    source: 'estimated',
    centroid: { lat: -33.3480, lng: -70.5120 },
    geojson: rect(-33.3480, -70.5120),
  },

  // ── PROVIDENCIA ───────────────────────────────────────────────────────────
  {
    id: 'parcel-providencia-1',
    comuna: 'Providencia',
    rol: '3301-99',
    source: 'ide_chile',
    centroid: { lat: -33.4320, lng: -70.6145 },
    geojson: rect(-33.4320, -70.6145, 0.0004, 0.0006),
  },
  {
    id: 'parcel-providencia-2',
    comuna: 'Providencia',
    rol: '3302-45',
    source: 'ide_chile',
    centroid: { lat: -33.4295, lng: -70.6100 },
    geojson: rect(-33.4295, -70.6100, 0.0004, 0.0005),
  },

  // ── LA REINA ──────────────────────────────────────────────────────────────
  {
    id: 'parcel-lareina-1',
    comuna: 'La Reina',
    rol: '6601-17',
    source: 'ide_chile',
    centroid: { lat: -33.4479, lng: -70.5458 },
    geojson: rect(-33.4479, -70.5458, 0.0006, 0.0008),
  },

  // ── ÑUÑOA ─────────────────────────────────────────────────────────────────
  {
    id: 'parcel-nunoa-1',
    comuna: 'Ñuñoa',
    rol: '4401-88',
    source: 'ide_chile',
    centroid: { lat: -33.4574, lng: -70.5962 },
    geojson: rect(-33.4574, -70.5962, 0.0004, 0.0005),
  },
  {
    id: 'parcel-nunoa-2',
    comuna: 'Ñuñoa',
    rol: '4402-21',
    source: 'estimated',
    centroid: { lat: -33.4600, lng: -70.5930 },
    geojson: rect(-33.4600, -70.5930, 0.0004, 0.0006),
  },

  // ── ZAPALLAR ──────────────────────────────────────────────────────────────
  {
    id: 'parcel-zapallar-1',
    comuna: 'Zapallar',
    rol: '88-4',
    source: 'ide_chile',
    centroid: { lat: -32.5538, lng: -71.4633 },
    geojson: rect(-32.5538, -71.4633, 0.0007, 0.001),
  },
  {
    id: 'parcel-zapallar-cachagua-1',
    comuna: 'Zapallar',
    rol: '89-2',
    source: 'ide_chile',
    centroid: { lat: -32.5620, lng: -71.4580 },
    geojson: rect(-32.5620, -71.4580, 0.0008, 0.001),
  },

  // ── PUCHUNCAVÍ / MAITENCILLO ──────────────────────────────────────────────
  {
    id: 'parcel-maitencillo-1',
    comuna: 'Puchuncaví',
    rol: '120-7',
    source: 'ide_chile',
    centroid: { lat: -32.6421, lng: -71.4167 },
    geojson: rect(-32.6421, -71.4167, 0.0008, 0.0011),
  },

  // ── PUCÓN ─────────────────────────────────────────────────────────────────
  {
    id: 'parcel-pucon-1',
    comuna: 'Pucón',
    rol: '990-3',
    source: 'ide_chile',
    centroid: { lat: -39.2772, lng: -71.9788 },
    geojson: rect(-39.2772, -71.9788, 0.0008, 0.001),
  },
  {
    id: 'parcel-pucon-2',
    comuna: 'Pucón',
    rol: '991-15',
    source: 'estimated',
    centroid: { lat: -39.2810, lng: -71.9750 },
    geojson: rect(-39.2810, -71.9750, 0.0007, 0.001),
  },

  // ── VILLARRICA ────────────────────────────────────────────────────────────
  {
    id: 'parcel-villarrica-1',
    comuna: 'Villarrica',
    rol: '880-6',
    source: 'ide_chile',
    centroid: { lat: -39.2803, lng: -72.2267 },
    geojson: rect(-39.2803, -72.2267, 0.0007, 0.001),
  },
]

export const MOCK_LISTING_PINS: CadastreListingPin[] = [
  // ── VITACURA ──────────────────────────────────────────────────────────────
  {
    id: 'mlc-vit-1',
    title: 'Casa Vitacura · Corredora A',
    comuna: 'Vitacura',
    lat: -33.3893, lng: -70.5981,
    location_confidence: 'confirmed',
    rol_matriz: '1234-56',
    matched_parcel_id: 'parcel-vitacura-1',
    agency_count: 6,
  },
  {
    id: 'mlc-vit-2',
    title: 'Casa Vitacura · Corredora B',
    comuna: 'Vitacura',
    lat: -33.3898, lng: -70.5977,
    location_confidence: 'confirmed',
    rol_matriz: '1234-56',
    matched_parcel_id: 'parcel-vitacura-1',
    agency_count: 6,
  },
  {
    id: 'mlc-vit-3',
    title: 'Casa Vitacura · Pin sospechoso',
    comuna: 'Vitacura',
    lat: -33.392, lng: -70.600,
    location_confidence: 'pin_suspect',
    rol_matriz: null,
    matched_parcel_id: null,
    agency_count: 6,
  },
  {
    id: 'mlc-vit-4',
    title: 'Depto Vitacura · Particular',
    comuna: 'Vitacura',
    lat: -33.3872, lng: -70.5952,
    location_confidence: 'confirmed',
    rol_matriz: '1235-10',
    matched_parcel_id: 'parcel-vitacura-2',
    agency_count: 1,
  },

  // ── LAS CONDES ────────────────────────────────────────────────────────────
  {
    id: 'mlc-lc-1',
    title: 'Depto Las Condes · Corredora A',
    comuna: 'Las Condes',
    lat: -33.4097, lng: -70.5675,
    location_confidence: 'confirmed',
    rol_matriz: '5501-22',
    matched_parcel_id: 'parcel-lascondes-1',
    agency_count: 4,
  },
  {
    id: 'mlc-lc-2',
    title: 'Casa Las Condes · Corredora B',
    comuna: 'Las Condes',
    lat: -33.4122, lng: -70.5642,
    location_confidence: 'confirmed',
    rol_matriz: '5502-08',
    matched_parcel_id: 'parcel-lascondes-2',
    agency_count: 3,
  },
  {
    id: 'mlc-lc-3',
    title: 'Oficina Las Condes · Sin rol',
    comuna: 'Las Condes',
    lat: -33.4062, lng: -70.5712,
    location_confidence: 'candidate',
    rol_matriz: null,
    matched_parcel_id: null,
    agency_count: 2,
  },
  {
    id: 'mlc-lc-4',
    title: 'Penthouse Las Condes · Corredora C',
    comuna: 'Las Condes',
    lat: -33.4080, lng: -70.5690,
    location_confidence: 'candidate',
    rol_matriz: '5503-14',
    matched_parcel_id: 'parcel-lascondes-3',
    agency_count: 2,
  },

  // ── LO BARNECHEA ──────────────────────────────────────────────────────────
  {
    id: 'mlc-lb-1',
    title: 'Casa Lo Barnechea · Particular',
    comuna: 'Lo Barnechea',
    lat: -33.3506, lng: -70.5165,
    location_confidence: 'confirmed',
    rol_matriz: '7710-01',
    matched_parcel_id: 'parcel-lobarnechea-1',
    agency_count: 1,
  },
  {
    id: 'mlc-lb-2',
    title: 'Parcela Lo Barnechea · Pin sospechoso',
    comuna: 'Lo Barnechea',
    lat: -33.3530, lng: -70.5090,
    location_confidence: 'pin_suspect',
    rol_matriz: null,
    matched_parcel_id: null,
    agency_count: 3,
  },

  // ── PROVIDENCIA ───────────────────────────────────────────────────────────
  {
    id: 'mlc-prov-1',
    title: 'Depto Providencia · Corredora A',
    comuna: 'Providencia',
    lat: -33.4322, lng: -70.6143,
    location_confidence: 'confirmed',
    rol_matriz: '3301-99',
    matched_parcel_id: 'parcel-providencia-1',
    agency_count: 5,
  },
  {
    id: 'mlc-prov-2',
    title: 'Casa Providencia · Particular',
    comuna: 'Providencia',
    lat: -33.4297, lng: -70.6102,
    location_confidence: 'confirmed',
    rol_matriz: '3302-45',
    matched_parcel_id: 'parcel-providencia-2',
    agency_count: 1,
  },

  // ── LA REINA ──────────────────────────────────────────────────────────────
  {
    id: 'mlc-lr-1',
    title: 'Casa La Reina · Corredora A',
    comuna: 'La Reina',
    lat: -33.4481, lng: -70.5456,
    location_confidence: 'confirmed',
    rol_matriz: '6601-17',
    matched_parcel_id: 'parcel-lareina-1',
    agency_count: 2,
  },
  {
    id: 'mlc-lr-2',
    title: 'Casa La Reina · Candidata',
    comuna: 'La Reina',
    lat: -33.4501, lng: -70.5430,
    location_confidence: 'candidate',
    rol_matriz: null,
    matched_parcel_id: null,
    agency_count: 1,
  },

  // ── ÑUÑOA ─────────────────────────────────────────────────────────────────
  {
    id: 'mlc-nun-1',
    title: 'Depto Ñuñoa · Corredora A',
    comuna: 'Ñuñoa',
    lat: -33.4576, lng: -70.5960,
    location_confidence: 'confirmed',
    rol_matriz: '4401-88',
    matched_parcel_id: 'parcel-nunoa-1',
    agency_count: 3,
  },
  {
    id: 'mlc-nun-2',
    title: 'Casa Ñuñoa · Particular',
    comuna: 'Ñuñoa',
    lat: -33.4602, lng: -70.5928,
    location_confidence: 'candidate',
    rol_matriz: null,
    matched_parcel_id: null,
    agency_count: 1,
  },

  // ── ZAPALLAR ──────────────────────────────────────────────────────────────
  {
    id: 'mlc-zap-1',
    title: 'Casa con piscina · Zapallar',
    comuna: 'Zapallar',
    lat: -32.5539, lng: -71.4634,
    location_confidence: 'confirmed',
    rol_matriz: '88-4',
    matched_parcel_id: 'parcel-zapallar-1',
    agency_count: 2,
  },
  {
    id: 'mlc-zap-2',
    title: 'Cabaña · Cachagua',
    comuna: 'Zapallar',
    lat: -32.5618, lng: -71.4582,
    location_confidence: 'confirmed',
    rol_matriz: '89-2',
    matched_parcel_id: 'parcel-zapallar-cachagua-1',
    agency_count: 1,
  },
  {
    id: 'mlc-zap-3',
    title: 'Lote · Zapallar (pin sospechoso)',
    comuna: 'Zapallar',
    lat: -32.5560, lng: -71.4700,
    location_confidence: 'pin_suspect',
    rol_matriz: null,
    matched_parcel_id: null,
    agency_count: 3,
  },

  // ── PUCHUNCAVÍ / MAITENCILLO ──────────────────────────────────────────────
  {
    id: 'mlc-mai-1',
    title: 'Casa frente al mar · Maitencillo',
    comuna: 'Puchuncaví',
    lat: -32.6423, lng: -71.4165,
    location_confidence: 'confirmed',
    rol_matriz: '120-7',
    matched_parcel_id: 'parcel-maitencillo-1',
    agency_count: 4,
  },
  {
    id: 'mlc-mai-2',
    title: 'Depto · Maitencillo (candidato)',
    comuna: 'Puchuncaví',
    lat: -32.6445, lng: -71.4140,
    location_confidence: 'candidate',
    rol_matriz: null,
    matched_parcel_id: null,
    agency_count: 2,
  },

  // ── PUCÓN ─────────────────────────────────────────────────────────────────
  {
    id: 'mlc-puc-1',
    title: 'Casa lago Villarrica · Pucón',
    comuna: 'Pucón',
    lat: -39.2774, lng: -71.9786,
    location_confidence: 'confirmed',
    rol_matriz: '990-3',
    matched_parcel_id: 'parcel-pucon-1',
    agency_count: 3,
  },
  {
    id: 'mlc-puc-2',
    title: 'Parcela con vista · Pucón',
    comuna: 'Pucón',
    lat: -39.2812, lng: -71.9748,
    location_confidence: 'candidate',
    rol_matriz: '991-15',
    matched_parcel_id: 'parcel-pucon-2',
    agency_count: 1,
  },
  {
    id: 'mlc-puc-3',
    title: 'Cabaña turística · Pucón (pin sospechoso)',
    comuna: 'Pucón',
    lat: -39.2850, lng: -71.9710,
    location_confidence: 'pin_suspect',
    rol_matriz: null,
    matched_parcel_id: null,
    agency_count: 2,
  },

  // ── VILLARRICA ────────────────────────────────────────────────────────────
  {
    id: 'mlc-vil-1',
    title: 'Casa borde lago · Villarrica',
    comuna: 'Villarrica',
    lat: -39.2805, lng: -72.2265,
    location_confidence: 'confirmed',
    rol_matriz: '880-6',
    matched_parcel_id: 'parcel-villarrica-1',
    agency_count: 2,
  },
  {
    id: 'mlc-vil-2',
    title: 'Terreno · Villarrica (candidato)',
    comuna: 'Villarrica',
    lat: -39.2830, lng: -72.2240,
    location_confidence: 'candidate',
    rol_matriz: null,
    matched_parcel_id: null,
    agency_count: 1,
  },
]
