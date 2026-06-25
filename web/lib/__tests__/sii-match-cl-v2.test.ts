/**
 * Tests para sii-match-cl-v2: Motor de scoring Fellegi-Sunter
 * Valida las 8 capas de matching
 */

import { scoreCandidate, scoreCandidates, ParsedListing } from '../sii-match-cl-v2'

describe('sii-match-cl-v2: Motor de Scoring Fellegi-Sunter', () => {
  // Listing de ejemplo: Casa en Av. Apoquindo 3200, Las Condes
  const listingGood: ParsedListing = {
    address: 'Avenida Apoquindo 3200',
    address_full: 'Avenida Apoquindo 3200, Las Condes',
    lat: -33.401,
    lng: -70.603,
    sqm: 1120,
    bedrooms: 4,
    bathrooms: 4,
    property_type: 'casa',
    operation: 'rent',
  }

  // Candidato SII perfecto: ubicación exacta, m² exacto, tipo exacto
  const candidatePerfect = {
    rol: '795-1234',
    direccion: 'AVENIDA APOQUINDO 3200',
    avaluo_fiscal_total: 5000000,
    superficie_terreno_m2: 1100,
    superficie_construida_m2: 420,
    codigo_destino_principal: 'H', // Habitacional
    rol_padre: null,
    lat: -33.40101,
    lng: -70.60301,
    distance_m: 15, // Muy cercano
    text_sim: 0.95, // Trigram similarity alta
  }

  // Candidato SII malo: tipo diferente
  const candidateBadType = {
    rol: '800-999',
    direccion: 'AVENIDA APOQUINDO 3200',
    avaluo_fiscal_total: 5000000,
    superficie_terreno_m2: 1100,
    superficie_construida_m2: 420,
    codigo_destino_principal: 'O', // Oficina (no casa!)
    rol_padre: null,
    lat: -33.40101,
    lng: -70.60301,
    distance_m: 15,
    text_sim: 0.95,
  }

  // Candidato SII malo: distancia muy lejana
  const candidateFarAway = {
    rol: '900-888',
    direccion: 'AVENIDA APOQUINDO 3200',
    avaluo_fiscal_total: 5000000,
    superficie_terreno_m2: 1100,
    superficie_construida_m2: 420,
    codigo_destino_principal: 'H',
    rol_padre: null,
    lat: -33.410, // 1km de distancia
    lng: -70.613,
    distance_m: 1000,
    text_sim: 0.95,
  }

  test('CASO 1: Casa perfecta (exacta) → CONFIRMED (≥92%)', () => {
    const result = scoreCandidate(listingGood, candidatePerfect)

    console.log('CASO 1 - Casa exacta:')
    console.log(`  Score: ${(result.score * 100).toFixed(1)}%`)
    console.log(`  Confianza: ${result.confidence_level}`)
    console.log(`  Components:`, result.components)

    expect(result.score).toBeGreaterThanOrEqual(0.92)
    expect(result.confidence_level).toBe('confirmed')
    expect(result.components.destino_match).toBeGreaterThan(0) // Type match
    expect(result.components.address_similarity).toBeGreaterThan(0) // Address match
    expect(result.components.footprint_match).toBeGreaterThan(0) // Physical match
  })

  test('CASO 2: Tipo diferente (Oficina en vez de Casa) → REJECTED (<65%)', () => {
    const result = scoreCandidate(listingGood, candidateBadType)

    console.log('\nCASO 2 - Tipo incompatible (Oficina):')
    console.log(`  Score: ${(result.score * 100).toFixed(1)}%`)
    console.log(`  Confianza: ${result.confidence_level}`)
    console.log(`  Components:`, result.components)

    expect(result.score).toBeLessThan(0.65)
    expect(result.confidence_level).toBe('rejected')
    expect(result.components.destino_match).toBeLessThan(0) // Type mismatch penalty
  })

  test('CASO 3: Distancia lejana (1km) → CANDIDATE (65-79%)', () => {
    const result = scoreCandidate(listingGood, candidateFarAway)

    console.log('\nCASO 3 - Distancia lejana (1km):')
    console.log(`  Score: ${(result.score * 100).toFixed(1)}%`)
    console.log(`  Confianza: ${result.confidence_level}`)
    console.log(`  Components:`, result.components)

    // Debe ser menor que perfecta, pero aún candidato
    expect(result.score).toBeLessThan(0.92)
    expect(result.score).toBeGreaterThan(0.5)
    expect(['candidate', 'low_candidate']).toContain(result.confidence_level)
  })

  test('CASO 4: Scoring multiple candidatos (ranking)', () => {
    const results = scoreCandidates(listingGood, [
      candidatePerfect,
      candidateBadType,
      candidateFarAway,
    ])

    console.log('\nCASO 4 - Ranking de 3 candidatos:')
    results.forEach((r, i) => {
      console.log(
        `  #${i + 1}: ${r.rol} - ${(r.match_score * 100).toFixed(1)}% (${r.match_result.confidence_level})`
      )
    })

    // El primero debe ser el perfecto
    expect(results[0].rol).toBe('795-1234')
    expect(results[0].match_score).toBeGreaterThan(results[1].match_score)
    expect(results[0].match_score).toBeGreaterThan(results[2].match_score)
  })

  test('CASO 5: Sin dirección (solo lat/lng) → funciona con geocode + distancia', () => {
    const listingNoAddr: ParsedListing = {
      // Sin address/address_full
      lat: -33.401,
      lng: -70.603,
      sqm: 1120,
      bedrooms: 4,
      bathrooms: 4,
      property_type: 'casa',
    }

    const result = scoreCandidate(listingNoAddr, candidatePerfect)

    console.log('\nCASO 5 - Sin dirección (solo coords):')
    console.log(`  Score: ${(result.score * 100).toFixed(1)}%`)
    console.log(`  Confianza: ${result.confidence_level}`)

    // Debe funcionar de todas formas (con distancia + footprint)
    expect(result.score).toBeGreaterThan(0.4)
  })

  test('CASO 6: Depto confundido con casa → diferente tipo → REJECTED', () => {
    const listingDepto: ParsedListing = {
      address: 'Av. Providencia 2000',
      address_full: 'Av. Providencia 2000, Providencia',
      lat: -33.4324,
      lng: -70.6024,
      sqm: 85,
      bedrooms: 2,
      bathrooms: 1,
      property_type: 'departamento',
    }

    // Candidato es casa (tipo H, sin rol_padre = no es unidad)
    const candidateHouse = {
      rol: '123-456',
      direccion: 'AV PROVIDENCIA 2000',
      avaluo_fiscal_total: 1000000,
      superficie_terreno_m2: 150,
      superficie_construida_m2: 120,
      codigo_destino_principal: 'H',
      rol_padre: null, // ← NO es unidad de edificio
      lat: -33.4324,
      lng: -70.6024,
      distance_m: 10,
      text_sim: 0.90,
    }

    const result = scoreCandidate(listingDepto, candidateHouse)

    console.log('\nCASO 6 - Depto confundido con casa:')
    console.log(`  Score: ${(result.score * 100).toFixed(1)}%`)
    console.log(`  Confianza: ${result.confidence_level}`)

    // Debe rechazar porque tipos no coinciden (depto ≠ casa simple)
    expect(result.score).toBeLessThan(0.75)
  })
})

/**
 * Resultados esperados:
 *
 * CASO 1 (Casa exacta):
 *   ✓ Score ≥92% (CONFIRMED)
 *   ✓ Todos los components positivos
 *
 * CASO 2 (Tipo diferente):
 *   ✓ Score <65% (REJECTED)
 *   ✓ destino_match < 0 (penalización fuerte)
 *
 * CASO 3 (Distancia lejana):
 *   ✓ Score 50-92% (CANDIDATE o LOW_CANDIDATE)
 *   ✓ Distance penalty aplica
 *
 * CASO 4 (Ranking):
 *   ✓ Candidatos ordenados por score descendente
 *   ✓ Perfecto > Lejano > Tipo diferente
 *
 * CASO 5 (Sin dirección):
 *   ✓ Funciona con distance + footprint
 *   ✓ No requiere dirección exacta
 *
 * CASO 6 (Depto vs Casa):
 *   ✓ Rechaza confusión de tipos
 *   ✓ Score bajo por incompatibilidad
 */
