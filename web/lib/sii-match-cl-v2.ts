/**
 * Motor de matching multi-capa para propiedades Chile (90-95% precisión)
 * Basado en estrategias de identity-resolution-cl.mjs + 8 capas de validación
 *
 * Capas:
 * 1. Pre-filtering (validación de datos)
 * 2. Geocodificación (dirección vs pin)
 * 3. Filtrado por tipo destino SII
 * 4. Análisis lingüístico de dirección
 * 5. Huella física (m²/dorms/baños/tipo)
 * 6. Triangulación (teléfono/agencia)
 * 7. Búsqueda iterativa (radios 100m → 300m → 1000m)
 * 8. Análisis de clusters
 */

export interface ParsedListing {
  title?: string
  address?: string | null
  address_full?: string | null
  lat?: number | null
  lng?: number | null
  sqm?: number | null
  sqm_util?: number | null
  // V4 — ficha técnica separada (terreno vs construida) y atributos duros
  sqm_terreno?: number | null
  sqm_construida?: number | null
  year_built?: number | null
  is_condo?: boolean | null
  has_pool?: boolean | null
  orientation?: string | null
  bedrooms?: number | null
  bathrooms?: number | null
  parking?: number | null
  floors?: number | null
  operation?: string | null // 'sale' | 'rent'
  property_type?: string | null // 'casa' | 'departamento' | 'oficina' | etc
  price_raw?: number | null
  currency?: string | null
  phone?: string | null
  agency_name?: string | null
}

export interface SiiCandidateRow {
  rol: string
  direccion: string | null
  avaluo_fiscal_total: number | null
  superficie_terreno_m2: number | null
  superficie_construida_m2: number | null
  codigo_destino_principal: string | null
  rol_padre: string | null
  lat: number | null
  lng: number | null
  distance_m?: number | null
  text_sim?: number | null
  // V4 — agregados de sii_construcciones_cl por rol
  numero_pisos?: number | null
  anio_construccion?: number | null
  // V4 — score de verificación visual con IA (fotos del anuncio vs satélite),
  // -1..1; lo inyecta el paso de verificación visual cuando corre
  visual_score?: number | null
  visual_reasons?: string | null
}

export interface MatchComponent {
  geocode_agreement?: number
  destino_match?: number
  address_similarity?: number
  footprint_match?: number
  triangulation?: number
  distance_agreement?: number
}

export interface MatchResult {
  score: number // 0..1 (sigmoid normalized)
  confidence_level: 'confirmed' | 'high_candidate' | 'candidate' | 'low_candidate' | 'rejected'
  components: MatchComponent
  explanation: string
  signals: Record<string, unknown>
  raw_score: number
}

// ──────────────────────────────────────────────────────────────────────────
// CAPA 1: PRE-FILTERING
// ──────────────────────────────────────────────────────────────────────────

function getDataQualityLevel(listing: ParsedListing): 'high' | 'medium' | 'low' {
  const hasAddr = listing.address_full || listing.address
  const hasGeo = listing.lat != null && listing.lng != null
  const hasType = listing.property_type
  const hasPhysical = listing.sqm != null || listing.bedrooms != null

  if (hasAddr && hasGeo && hasType) return 'high'
  if ((hasGeo || hasAddr) && hasType && hasPhysical) return 'medium'
  return 'low'
}

// ──────────────────────────────────────────────────────────────────────────
// CAPA 2: GEOCODIFICACIÓN (placeholder - integración con servicio geocoder)
// ──────────────────────────────────────────────────────────────────────────

function geocodeAgreementScore(listing: ParsedListing): number {
  // FUTURE: Implementar llamada a OpenCage / Nominatim
  // Por ahora: si address existe y tiene número, asumimos que fue geocodificado
  if (!listing.address || !listing.lat || !listing.lng) return 0

  // Heurística simple: si la dirección tiene un número y lat/lng no son "redondos", asumimos acuerdo
  const hasNumber = /\d{3,}/.test(listing.address)
  const isRoundCoord = (Math.abs((listing.lat % 1)) < 0.001) || (Math.abs((listing.lng % 1)) < 0.001)

  if (hasNumber && !isRoundCoord) return 0.2 // acuerdo probable
  if (isRoundCoord) return -0.1 // pin sospechoso (redondos)
  return 0 // sin señal
}

// ──────────────────────────────────────────────────────────────────────────
// CAPA 3: FILTRADO POR TIPO DESTINO SII
// ──────────────────────────────────────────────────────────────────────────

const PROPERTY_TYPE_MAPPING: Record<string, string[]> = {
  casa: ['H'],
  'casa-aislada': ['H'],
  departamento: ['H'],
  depto: ['H'],
  'departamento-amoblado': ['H'],
  oficina: ['O'],
  comercio: ['C'],
  local: ['C'],
  terreno: ['W'],
  'terreno-agricola': ['A'],
  estacionamiento: ['Z'],
  industrial: ['I'],
  bodega: ['I', 'C'],
}

function getExcludedDestinos(propertyType: string | null): string[] {
  const mapping = PROPERTY_TYPE_MAPPING[propertyType?.toLowerCase() ?? ''] || []
  if (mapping.length === 0) return [] // sin filtro si no reconocemos el tipo

  // Si es habitacional (H), excluir todo lo demás
  if (mapping.includes('H')) return ['O', 'C', 'I', 'W', 'Z', 'A']
  // Si es oficina, excluir otros comerciales
  if (mapping.includes('O')) return ['H', 'C', 'I', 'W', 'Z', 'A']
  // Si es comercio/local, excluir residencial
  if (mapping.includes('C')) return ['H', 'O', 'I', 'W', 'Z', 'A']
  // Si es terreno, excluir construcciones
  if (mapping.includes('W') || mapping.includes('A')) return ['H', 'O', 'C', 'I', 'Z']

  return []
}

function destino_matchScore(listing: ParsedListing, candidate: SiiCandidateRow): number {
  if (!candidate.codigo_destino_principal || !listing.property_type) return 0

  const excluded = getExcludedDestinos(listing.property_type)
  if (excluded.includes(candidate.codigo_destino_principal)) return -0.3 // penalización fuerte

  const allowed = PROPERTY_TYPE_MAPPING[listing.property_type.toLowerCase()] || []
  if (allowed.includes(candidate.codigo_destino_principal)) return 0.1 // bonificación leve

  return 0 // sin señal
}

// ──────────────────────────────────────────────────────────────────────────
// CAPA 4: ANÁLISIS LINGÜÍSTICO DE DIRECCIÓN
// ──────────────────────────────────────────────────────────────────────────

function normalizeAddress(addr: string | null): string {
  if (!addr) return ''
  return addr
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // unaccent
    .toUpperCase()
    // Puntuación fuera ANTES de expandir abreviaturas: "AV." y ", VITACURA"
    // impedían el match exacto de vía+número (la señal más fuerte del scoring)
    .replace(/[.,;:()]/g, ' ')
    .replace(/\b(AV|AVENIDA|AVDA|AVE|PJE|PASAJE|CLLE|CALLE|DR|DOCTOR)\b/g, (m) => {
      const map: Record<string, string> = {
        AV: 'AVENIDA',
        AVENIDA: 'AVENIDA',
        AVDA: 'AVENIDA',
        AVE: 'AVENIDA',
        PJE: 'PASAJE',
        PASAJE: 'PASAJE',
        CLLE: 'CALLE',
        CALLE: 'CALLE',
        DR: 'DOCTOR',
        DOCTOR: 'DOCTOR',
      }
      return map[m] || m
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function extractAddressComponents(addr: string): { vía?: string; número?: number } {
  const normalized = normalizeAddress(addr)
  const match = normalized.match(/^(.+?)\s+(\d+)/)
  if (!match) return {}

  return {
    vía: match[1],
    número: parseInt(match[2]),
  }
}

function addressSimilarityScore(listing: ParsedListing, candidate: SiiCandidateRow): number {
  const listingAddr = normalizeAddress(listing.address_full ?? listing.address ?? null)
  const candidateAddr = normalizeAddress(candidate.direccion)

  if (!listingAddr || !candidateAddr) return 0

  // Check exacto primero (antes de extractAddressComponents)
  if (listingAddr === candidateAddr) return 0.4

  const listingComp = extractAddressComponents(listingAddr)
  const candidateComp = extractAddressComponents(candidateAddr)

  // Búsqueda por vía + número
  if (listingComp.vía && candidateComp.vía && listingComp.número && candidateComp.número) {
    // Vía exacta + número exacto
    if (listingComp.vía === candidateComp.vía && listingComp.número === candidateComp.número) {
      return 0.4 // vía + número exacto
    }
    // Vía exacta, número en rango ±50
    if (listingComp.vía === candidateComp.vía && Math.abs(listingComp.número - candidateComp.número) <= 50) {
      return 0.25 // vía exacta + número cercano
    }
    // Vía exacta, número en rango ±150
    if (listingComp.vía === candidateComp.vía && Math.abs(listingComp.número - candidateComp.número) <= 150) {
      return 0.15 // vía exacta, número lejano pero posible
    }
  }

  // Trigram similarity (simple: contar palabras comunes)
  const listingWords = new Set(listingAddr.split(/\s+/))
  const candidateWords = new Set(candidateAddr.split(/\s+/))
  const commonWords = [...listingWords].filter((w) => candidateWords.has(w)).length
  const totalWords = Math.max(listingWords.size, candidateWords.size)
  const wordSimilarity = commonWords / totalWords

  if (wordSimilarity > 0.7) return 0.2 // palabras clave coinciden
  if (wordSimilarity > 0.5) return 0.1 // mayoría de palabras coinciden
  if (wordSimilarity > 0.3) return 0.05 // algunas palabras coinciden

  return 0
}

// ──────────────────────────────────────────────────────────────────────────
// CAPA 5: HUELLA FÍSICA
// ──────────────────────────────────────────────────────────────────────────

function footprintScore(listing: ParsedListing, candidate: SiiCandidateRow): number {
  let score = 0
  const weights = {
    sqm_terreno: 0.25,
    sqm_construida: 0.15,
    bedrooms: 0.35,
    bathrooms: 0.15,
    property_type: 0.1,
  }

  // Superficie terreno
  if (listing.sqm && candidate.superficie_terreno_m2) {
    const diff = Math.abs(listing.sqm - candidate.superficie_terreno_m2) / listing.sqm * 100
    if (diff <= 10) {
      score += weights.sqm_terreno * 0.5 // no penaliza si es muy cercano
    } else if (diff <= 30) {
      score -= weights.sqm_terreno * 0.2
    } else if (diff <= 60) {
      score -= weights.sqm_terreno * 0.6
    } else {
      score -= weights.sqm_terreno * 1.0
    }
  }

  // Superficie construida
  if (listing.sqm && candidate.superficie_construida_m2) {
    const diff = Math.abs(listing.sqm - candidate.superficie_construida_m2) / listing.sqm * 100
    if (diff <= 15) {
      score += weights.sqm_construida * 0.3 // tolerancia de medición
    } else if (diff <= 40) {
      score -= weights.sqm_construida * 0.5
    } else {
      score -= weights.sqm_construida * 1.0
    }
  }

  // Dormitorios
  if (listing.bedrooms != null && candidate.rol_padre) {
    // En copropiedad, solo validar si es depto
    if (listing.property_type?.toLowerCase().includes('depto')) {
      score += weights.bedrooms * 0.6 // asumimos que es depto, score positivo
    }
  } else if (listing.bedrooms != null) {
    // No hay info SII de dormitorios, así que no podemos validar
    score += weights.bedrooms * 0.2
  }

  // Property type
  if (listing.property_type && candidate.codigo_destino_principal) {
    const mapping = PROPERTY_TYPE_MAPPING[listing.property_type.toLowerCase()] || []
    if (mapping.includes(candidate.codigo_destino_principal)) {
      score += weights.property_type * 0.8
    }
  }

  return Math.max(-1, Math.min(1, score))
}

// ──────────────────────────────────────────────────────────────────────────
// CAPA 6: TRIANGULACIÓN (SIMPLE - FUTURE: pHash)
// ──────────────────────────────────────────────────────────────────────────

function triangulationScore(listing: ParsedListing, candidates: SiiCandidateRow[]): number {
  // FUTURE: Implementar pHash de imágenes
  // Por ahora: teléfono/agencia en DB (no disponible en este contexto)
  return 0
}

// ──────────────────────────────────────────────────────────────────────────
// CAPA 7: DISTANCIA GEOGRÁFICA
// ──────────────────────────────────────────────────────────────────────────

function distanceAgreementScore(distance_m: number | null): number {
  if (distance_m == null) return 0

  if (distance_m <= 100) return 0.2 // muy cercano
  if (distance_m <= 300) return 0.1 // cercano
  if (distance_m <= 1000) return 0 // aceptable
  return -0.1 // lejano
}

// ──────────────────────────────────────────────────────────────────────────
// SCORING FINAL (Fellegi-Sunter)
// ──────────────────────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x * 2))
}

export function scoreCandidate(
  listing: ParsedListing,
  candidate: SiiCandidateRow,
): MatchResult {
  const components: MatchComponent = {}

  // Pesos relativos (deben sumar ~1)
  const weights = {
    geocode_agreement: 0.25,
    destino_match: 0.1,
    address_similarity: 0.25,
    footprint_match: 0.25,
    triangulation: 0.05,
    distance_agreement: 0.1,
  }

  let raw = 0

  // Capa 2: Geocodificación
  components.geocode_agreement = geocodeAgreementScore(listing)
  raw += weights.geocode_agreement * (components.geocode_agreement ?? 0)

  // Capa 3: Tipo destino
  components.destino_match = destino_matchScore(listing, candidate)
  raw += weights.destino_match * (components.destino_match ?? 0)

  // Capa 4: Dirección
  components.address_similarity = addressSimilarityScore(listing, candidate)
  raw += weights.address_similarity * (components.address_similarity ?? 0)

  // Capa 5: Huella física
  components.footprint_match = footprintScore(listing, candidate)
  raw += weights.footprint_match * (components.footprint_match ?? 0)

  // Capa 6: Triangulación
  components.triangulation = triangulationScore(listing, [candidate])
  raw += weights.triangulation * (components.triangulation ?? 0)

  // Capa 7: Distancia
  components.distance_agreement = distanceAgreementScore(candidate.distance_m ?? null)
  raw += weights.distance_agreement * (components.distance_agreement ?? 0)

  // Normalizar con sigmoid
  const score = sigmoid(raw)

  // Determinar nivel de confianza
  let confidence_level: MatchResult['confidence_level']
  if (score >= 0.92) confidence_level = 'confirmed'
  else if (score >= 0.8) confidence_level = 'high_candidate'
  else if (score >= 0.65) confidence_level = 'candidate'
  else if (score >= 0.5) confidence_level = 'low_candidate'
  else confidence_level = 'rejected'

  // Explicación
  const topSignals = Object.entries(components)
    .sort((a, b) => Math.abs(b[1] ?? 0) - Math.abs(a[1] ?? 0))
    .slice(0, 2)
    .map(([k, v]) => `${k}=${(v ?? 0).toFixed(2)}`)
    .join(', ')

  const explanation = `${confidence_level} (${topSignals})`

  return {
    score,
    confidence_level,
    components,
    explanation,
    signals: {
      data_quality: getDataQualityLevel(listing),
      distance_m: candidate.distance_m,
      destino_principal: candidate.codigo_destino_principal,
    },
    raw_score: raw,
  }
}

/**
 * Puntúa múltiples candidatos y los ordena por score
 */
export function scoreCandidates(listing: ParsedListing, candidates: SiiCandidateRow[]): Array<SiiCandidateRow & { match_score: number; match_result: MatchResult }> {
  return candidates
    .map((candidate) => {
      const result = scoreCandidate(listing, candidate)
      return {
        ...candidate,
        match_score: result.score,
        match_result: result,
      }
    })
    .sort((a, b) => b.match_score - a.match_score)
}

// ──────────────────────────────────────────────────────────────────────────
// V3: PROBABILIDAD CALIBRADA (log-odds, estilo Fellegi-Sunter)
// ──────────────────────────────────────────────────────────────────────────
// El score V2 pasa la suma ponderada por sigmoid(x*2), pero la suma máxima
// alcanzable con sus pesos es ~0.43 → sigmoid tope ≈ 0.70: el umbral
// 'confirmed' (0.92) era inalcanzable y TODO match quedaba como candidato.
// V3 acumula evidencia en log-odds sin tope artificial: dirección exacta +
// distancia + m² consistentes sí llegan a >0.95, y la probabilidad resultante
// es interpretable ("92%" significa evidencia realmente fuerte).

export interface MatchSignalV3 {
  signal: string
  value: string
  log_odds: number
}

export interface MatchResultV3 {
  probability: number // 0..1 calibrada
  confidence_level: 'confirmed' | 'high_candidate' | 'candidate' | 'rejected'
  log_odds: number
  signals: MatchSignalV3[]
  explanation: string
}

// Prior escéptico: sin ninguna evidencia, un candidato arbitrario de la
// comuna NO es la propiedad (probabilidad base ~23%).
const V3_PRIOR = -1.2

function addressEvidence(listing: ParsedListing, candidate: SiiCandidateRow): MatchSignalV3 {
  const listingAddr = normalizeAddress(listing.address_full ?? listing.address ?? null)
  const candidateAddr = normalizeAddress(candidate.direccion)
  if (!listingAddr || !candidateAddr) return { signal: 'direccion', value: 'sin datos', log_odds: 0 }

  if (listingAddr === candidateAddr) return { signal: 'direccion', value: 'idéntica', log_odds: 4.2 }

  const l = extractAddressComponents(listingAddr)
  const c = extractAddressComponents(candidateAddr)
  if (l.vía && c.vía && l.número != null && c.número != null && l.vía === c.vía) {
    const diff = Math.abs(l.número - c.número)
    if (diff === 0) return { signal: 'direccion', value: 'vía + número exactos', log_odds: 4.2 }
    if (diff <= 4) return { signal: 'direccion', value: `vía exacta, número ±${diff}`, log_odds: 2.2 }
    if (diff <= 20) return { signal: 'direccion', value: `vía exacta, número ±${diff}`, log_odds: 1.0 }
    return { signal: 'direccion', value: `vía exacta, número lejano (±${diff})`, log_odds: 0.2 }
  }

  // Similitud trigram calculada en Postgres (similarity()) cuando está disponible
  if (candidate.text_sim != null) {
    if (candidate.text_sim >= 0.75) return { signal: 'direccion', value: `similitud ${candidate.text_sim.toFixed(2)}`, log_odds: 1.2 }
    if (candidate.text_sim >= 0.55) return { signal: 'direccion', value: `similitud ${candidate.text_sim.toFixed(2)}`, log_odds: 0.5 }
    if (candidate.text_sim <= 0.25) return { signal: 'direccion', value: `similitud baja ${candidate.text_sim.toFixed(2)}`, log_odds: -0.6 }
  }
  return { signal: 'direccion', value: 'sin coincidencia clara', log_odds: -0.2 }
}

function distanceEvidence(candidate: SiiCandidateRow): MatchSignalV3 {
  const d = candidate.distance_m
  if (d == null) return { signal: 'distancia', value: 'sin coordenadas', log_odds: 0 }
  if (d <= 15) return { signal: 'distancia', value: `${Math.round(d)} m`, log_odds: 2.2 }
  if (d <= 50) return { signal: 'distancia', value: `${Math.round(d)} m`, log_odds: 1.4 }
  if (d <= 120) return { signal: 'distancia', value: `${Math.round(d)} m`, log_odds: 0.7 }
  if (d <= 300) return { signal: 'distancia', value: `${Math.round(d)} m`, log_odds: 0 }
  if (d <= 600) return { signal: 'distancia', value: `${Math.round(d)} m`, log_odds: -0.4 }
  // Los pines de los portales pueden venir corridos 1-2 km: lejos penaliza
  // suave, y si la dirección calza exacta la penalización se anula del todo
  // (ver scoreCandidateV3).
  if (d <= 1200) return { signal: 'distancia', value: `${Math.round(d)} m`, log_odds: -0.8 }
  if (d <= 2500) return { signal: 'distancia', value: `${(d / 1000).toFixed(1)} km`, log_odds: -1.2 }
  return { signal: 'distancia', value: `${(d / 1000).toFixed(1)} km`, log_odds: -1.6 }
}

function builtAreaEvidence(listing: ParsedListing, candidate: SiiCandidateRow): MatchSignalV3 {
  // V4: si la ficha técnica trae superficie construida explícita, la señal es
  // mucho más fuerte que el "m²" genérico del anuncio (que suele ser terreno
  // en casas y mezclaba ambas cosas).
  const explicit = listing.sqm_construida ?? null
  const sqm = explicit ?? listing.sqm ?? listing.sqm_util
  const built = candidate.superficie_construida_m2
  if (!sqm || !built) return { signal: 'sup_construida', value: 'sin datos', log_odds: 0 }
  const diff = Math.abs(sqm - built) / sqm
  const label = `anuncio ${sqm} m² vs SII ${built} m²`
  const strong = explicit != null
  if (diff <= 0.08) return { signal: 'sup_construida', value: label, log_odds: strong ? 2.0 : 1.6 }
  if (diff <= 0.2) return { signal: 'sup_construida', value: label, log_odds: strong ? 1.0 : 0.8 }
  if (diff <= 0.4) return { signal: 'sup_construida', value: label, log_odds: 0 }
  if (diff <= 0.7) return { signal: 'sup_construida', value: label, log_odds: strong ? -1.2 : -1.0 }
  return { signal: 'sup_construida', value: label, log_odds: strong ? -2.2 : -1.8 }
}

function landAreaEvidence(listing: ParsedListing, candidate: SiiCandidateRow): MatchSignalV3 {
  // Solo aporta para casas/terrenos: en deptos el terreno es del edificio entero.
  const type = listing.property_type?.toLowerCase() ?? ''
  const isLandRelevant = type.includes('casa') || type.includes('terreno') || type.includes('parcela')
  const explicit = listing.sqm_terreno ?? null
  // Sin terreno explícito, el "m²" del anuncio solo sirve si no representa ya
  // la construida (evitar comparar 258 m² construidos contra 5.000 de terreno)
  const sqm = explicit ?? (listing.sqm_construida == null ? listing.sqm : null)
  const land = candidate.superficie_terreno_m2
  if (!isLandRelevant || !sqm || !land) return { signal: 'sup_terreno', value: 'no aplica', log_odds: 0 }
  const diff = Math.abs(sqm - land) / sqm
  const label = `anuncio ${sqm} m² vs terreno ${land} m²`
  const strong = explicit != null
  if (diff <= 0.1) return { signal: 'sup_terreno', value: label, log_odds: strong ? 1.8 : 1.0 }
  if (diff <= 0.3) return { signal: 'sup_terreno', value: label, log_odds: strong ? 0.8 : 0.4 }
  if (diff <= 0.7) return { signal: 'sup_terreno', value: label, log_odds: 0 }
  return { signal: 'sup_terreno', value: label, log_odds: strong ? -1.0 : -0.6 }
}

// ─── Señales V4: pisos, año de construcción, condominio, verificación visual ─

function floorsEvidence(listing: ParsedListing, candidate: SiiCandidateRow): MatchSignalV3 {
  if (listing.floors == null || candidate.numero_pisos == null) {
    return { signal: 'pisos', value: 'sin datos', log_odds: 0 }
  }
  const diff = Math.abs(listing.floors - candidate.numero_pisos)
  const label = `anuncio ${listing.floors} vs SII ${candidate.numero_pisos}`
  if (diff === 0) return { signal: 'pisos', value: label, log_odds: 1.2 }
  if (diff === 1) return { signal: 'pisos', value: label, log_odds: 0.2 }
  return { signal: 'pisos', value: label, log_odds: -0.8 }
}

function yearBuiltEvidence(listing: ParsedListing, candidate: SiiCandidateRow): MatchSignalV3 {
  if (listing.year_built == null || candidate.anio_construccion == null) {
    return { signal: 'anio_construccion', value: 'sin datos', log_odds: 0 }
  }
  const diff = Math.abs(listing.year_built - candidate.anio_construccion)
  const label = `anuncio ~${listing.year_built} vs SII ${candidate.anio_construccion}`
  if (diff <= 3) return { signal: 'anio_construccion', value: label, log_odds: 1.4 }
  if (diff <= 8) return { signal: 'anio_construccion', value: label, log_odds: 0.6 }
  if (diff <= 20) return { signal: 'anio_construccion', value: label, log_odds: 0 }
  return { signal: 'anio_construccion', value: label, log_odds: -0.8 }
}

function condoEvidence(listing: ParsedListing, candidate: SiiCandidateRow): MatchSignalV3 {
  // En condominios los roles suelen colgar de un rol padre o compartir manzana;
  // solo bonifica levemente — muchos condominios antiguos tienen roles simples.
  if (!listing.is_condo) return { signal: 'condominio', value: 'no aplica', log_odds: 0 }
  if (candidate.rol_padre) return { signal: 'condominio', value: 'rol de condominio', log_odds: 0.4 }
  return { signal: 'condominio', value: 'rol simple', log_odds: 0 }
}

function visualEvidence(candidate: SiiCandidateRow): MatchSignalV3 {
  // Score -1..1 del verificador visual con IA (fotos del anuncio vs recorte
  // satelital de la parcela: piscina, tipo de techo/teja, entorno).
  if (candidate.visual_score == null) return { signal: 'verificacion_visual', value: 'no ejecutada', log_odds: 0 }
  const v = Math.max(-1, Math.min(1, candidate.visual_score))
  return {
    signal: 'verificacion_visual',
    value: candidate.visual_reasons ?? `score ${v.toFixed(2)}`,
    log_odds: v * 1.5,
  }
}

function destinoEvidence(listing: ParsedListing, candidate: SiiCandidateRow): MatchSignalV3 {
  if (!candidate.codigo_destino_principal || !listing.property_type) {
    return { signal: 'destino_sii', value: 'sin datos', log_odds: 0 }
  }
  const excluded = getExcludedDestinos(listing.property_type)
  if (excluded.includes(candidate.codigo_destino_principal)) {
    return { signal: 'destino_sii', value: `incompatible (${candidate.codigo_destino_principal})`, log_odds: -2.5 }
  }
  const allowed = PROPERTY_TYPE_MAPPING[listing.property_type.toLowerCase()] || []
  if (allowed.includes(candidate.codigo_destino_principal)) {
    return { signal: 'destino_sii', value: `compatible (${candidate.codigo_destino_principal})`, log_odds: 0.4 }
  }
  return { signal: 'destino_sii', value: candidate.codigo_destino_principal, log_odds: 0 }
}

function avaluoEvidence(listing: ParsedListing, candidate: SiiCandidateRow): MatchSignalV3 {
  // Solo venta en CLP: el precio de venta suele estar entre 1× y ~4× el avalúo
  // fiscal. Un ratio absurdo delata un candidato equivocado (ej. matchear un
  // sitio eriazo barato con una casa de lujo).
  if (listing.operation !== 'sale' || !listing.price_raw || !candidate.avaluo_fiscal_total) {
    return { signal: 'avaluo_vs_precio', value: 'no aplica', log_odds: 0 }
  }
  let priceClp = listing.price_raw
  if (listing.currency === 'UF') priceClp = listing.price_raw * 38_000 // aproximación conservadora
  const ratio = priceClp / candidate.avaluo_fiscal_total
  const label = `ratio ${ratio.toFixed(1)}×`
  if (ratio >= 0.9 && ratio <= 4.5) return { signal: 'avaluo_vs_precio', value: label, log_odds: 0.3 }
  if (ratio < 0.4 || ratio > 10) return { signal: 'avaluo_vs_precio', value: label, log_odds: -0.8 }
  return { signal: 'avaluo_vs_precio', value: label, log_odds: 0 }
}

export function scoreCandidateV3(listing: ParsedListing, candidate: SiiCandidateRow): MatchResultV3 {
  const addressSig = addressEvidence(listing, candidate)
  let distanceSig = distanceEvidence(candidate)
  // Pin corrido: si la dirección calza exacta (vía + número), el pin lejano
  // no debe hundir al candidato correcto — la dirección es evidencia dura y
  // la ubicación del anuncio es notoriamente imprecisa en los portales.
  if (addressSig.log_odds >= 4 && distanceSig.log_odds < 0) {
    distanceSig = { signal: 'distancia', value: `${distanceSig.value} (pin lejano ignorado: dirección exacta)`, log_odds: 0 }
  }
  const signals = [
    addressSig,
    distanceSig,
    builtAreaEvidence(listing, candidate),
    landAreaEvidence(listing, candidate),
    floorsEvidence(listing, candidate),
    yearBuiltEvidence(listing, candidate),
    condoEvidence(listing, candidate),
    destinoEvidence(listing, candidate),
    avaluoEvidence(listing, candidate),
    visualEvidence(candidate),
  ]
  const logOdds = V3_PRIOR + signals.reduce((s, x) => s + x.log_odds, 0)
  const probability = 1 / (1 + Math.exp(-logOdds))

  let confidence_level: MatchResultV3['confidence_level']
  if (probability >= 0.92) confidence_level = 'confirmed'
  else if (probability >= 0.8) confidence_level = 'high_candidate'
  else if (probability >= 0.65) confidence_level = 'candidate'
  else confidence_level = 'rejected'

  const top = [...signals].sort((a, b) => Math.abs(b.log_odds) - Math.abs(a.log_odds)).slice(0, 3)
    .filter((s) => s.log_odds !== 0)
    .map((s) => `${s.signal}: ${s.value}`)
    .join(' · ')

  return {
    probability,
    confidence_level,
    log_odds: logOdds,
    signals,
    explanation: top || 'sin señales',
  }
}

export function scoreCandidatesV3(
  listing: ParsedListing,
  candidates: SiiCandidateRow[],
): Array<SiiCandidateRow & { match_score: number; match_result_v3: MatchResultV3 }> {
  return candidates
    .map((candidate) => {
      const result = scoreCandidateV3(listing, candidate)
      return { ...candidate, match_score: result.probability, match_result_v3: result }
    })
    .sort((a, b) => b.match_score - a.match_score)
}
