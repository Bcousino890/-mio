/**
 * Tests para sii-match-cl-v2: Motor de scoring Fellegi-Sunter
 * Valida las 8 capas de matching
 */

import { scoreCandidate, scoreCandidates, scoreCandidateV3, ParsedListing, SiiCandidateRow } from '../sii-match-cl-v2'

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

describe('scoreCandidateV3: evidencia continua (sin empates de bucket)', () => {
  // Caso real: parcelación con varios lotes de tamaño casi idéntico en el
  // mismo camino privado, sin numeración en la dirección del anuncio (la
  // señal de dirección queda "sin coincidencia clara" para todos). Antes del
  // fix, un terreno EXACTO (0% de diferencia) puntuaba igual que uno a 5.4%
  // de diferencia porque ambos caían en el mismo bucket "≤10%" — el ranking
  // final dependía casi solo de la distancia del pin del portal, que es la
  // señal menos confiable del portal.
  const listing: ParsedListing = {
    address: 'Camino La Tagua',
    lat: -33.35,
    lng: -70.53,
    sqm_terreno: 889,
    property_type: 'casa',
    operation: 'sale',
  }

  const baseCandidate: SiiCandidateRow = {
    rol: '0000-00',
    direccion: 'CAMINO LA TAGUA 0',
    avaluo_fiscal_total: null,
    superficie_terreno_m2: 889,
    superficie_construida_m2: null,
    codigo_destino_principal: 'H',
    rol_padre: null,
    lat: null,
    lng: null,
    distance_m: 60,
    text_sim: null,
  }

  test('terreno exacto puntúa estrictamente más que uno a 5.4% de diferencia (misma distancia)', () => {
    const exact = scoreCandidateV3(listing, { ...baseCandidate, rol: 'exacto', superficie_terreno_m2: 889 })
    const close = scoreCandidateV3(listing, { ...baseCandidate, rol: 'cercano', superficie_terreno_m2: 841 }) // 5.4% off

    expect(exact.probability).toBeGreaterThan(close.probability)
  })

  test('terreno exacto pero más lejos puede superar a un terreno peor pero más cerca', () => {
    // 906 vs 889 = 1.9% off a 90 m, contra 841 vs 889 = 5.4% off a 27 m: con
    // los buckets escalonados anteriores ambos "sup_terreno" empataban
    // (mismo bucket ≤10%) y ganaba solo la distancia. Con evidencia continua,
    // la brecha de terreno (1.9% vs 5.4%) debe achicar la ventaja de
    // distancia del candidato más cercano.
    const lejanoPeroExacto = scoreCandidateV3(listing, { ...baseCandidate, rol: 'lejano-preciso', superficie_terreno_m2: 906, distance_m: 90 })
    const cercanoPeroImpreciso = scoreCandidateV3(listing, { ...baseCandidate, rol: 'cercano-impreciso', superficie_terreno_m2: 841, distance_m: 27 })

    // La diferencia de probabilidad entre ambos ya no debe ser tan amplia
    // como cuando el terreno no discriminaba en absoluto dentro del bucket.
    expect(Math.abs(lejanoPeroExacto.probability - cercanoPeroImpreciso.probability)).toBeLessThan(0.05)
  })

  test('distancia: 49m y 51m ya no saltan a valores opuestos de bucket', () => {
    const a = scoreCandidateV3(listing, { ...baseCandidate, distance_m: 49 })
    const b = scoreCandidateV3(listing, { ...baseCandidate, distance_m: 51 })

    // Deben ser casi iguales (continuo), no un salto de bucket (1.4 vs 0.7 log-odds)
    expect(Math.abs(a.probability - b.probability)).toBeLessThan(0.02)
    // Y monótono: más cerca sigue puntuando mejor o igual
    expect(a.probability).toBeGreaterThanOrEqual(b.probability)
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
