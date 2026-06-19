#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// test-zone-resolution.mjs
//
// Test script para validar que la resolución de zonas funciona correctamente.
// Usa zone-resolver.mjs y verifica que:
//   1. Los slugs de Idealista resuelven correctamente a IDs
//   2. Los nombres crudos (zone_raw) se resuelven a subzonas
//   3. La cache funciona
//   4. Los casos edge devuelven nulls seguros
//
// Uso:
//   node db/test-zone-resolution.mjs
// ─────────────────────────────────────────────────────────────────────────────

import pg from 'pg'
import { resolveZone, ZoneResolverCache } from './scraper/lib/zone-resolver.mjs'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('✗ Falta DATABASE_URL')
  process.exit(1)
}

const client = new pg.Client({ connectionString: DATABASE_URL })
const cache = new ZoneResolverCache()

async function test(name, idealista_slug, zone_raw, expectedDistrict, expectedZone, expectedSubzone) {
  console.log(`\n▶ Test: ${name}`)
  console.log(`  idealista_slug: ${idealista_slug}`)
  console.log(`  zone_raw: ${zone_raw || '(null)'}`)

  const result = await cache.resolveWithCache(client, idealista_slug, zone_raw)

  console.log(`  → district_id: ${result.district_id?.substring(0, 8) || 'null'}`)
  console.log(`  → zone_id: ${result.zone_id?.substring(0, 8) || 'null'}`)
  console.log(`  → subzone_id: ${result.subzone_id?.substring(0, 8) || 'null'}`)

  // Verificar si los resultados son los esperados
  let pass = true

  if (expectedDistrict !== null && result.district_id === null) {
    console.log(`  ✗ FALLO: Esperaba district_id, obtuvo null`)
    pass = false
  } else if (expectedDistrict === null && result.district_id !== null) {
    console.log(`  ✗ FALLO: Esperaba null district_id, obtuvo ID`)
    pass = false
  }

  if (expectedZone !== null && result.zone_id === null) {
    console.log(`  ✗ FALLO: Esperaba zone_id, obtuvo null`)
    pass = false
  } else if (expectedZone === null && result.zone_id !== null) {
    console.log(`  ✗ FALLO: Esperaba null zone_id, obtuvo ID`)
    pass = false
  }

  if (expectedSubzone !== null && result.subzone_id === null) {
    console.log(`  ✗ FALLO: Esperaba subzone_id, obtuvo null`)
    pass = false
  } else if (expectedSubzone === null && result.subzone_id !== null) {
    console.log(`  ✗ FALLO: Esperaba null subzone_id, obtuvo ID`)
    pass = false
  }

  if (pass) {
    console.log(`  ✓ PASS`)
  }

  return pass
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('TESTS: Zone Resolution (normalizado)')
  console.log('═══════════════════════════════════════════════════════════════')

  await client.connect()

  let passed = 0, failed = 0

  try {
    // Test 1: Resolución completa (distrito + zona + subzona)
    if (await test(
      'madrid/barrio-de-salamanca/goya (completa)',
      'madrid/barrio-de-salamanca/goya',
      'Barrio de Salamanca',
      'salamanca', 'barrio-salamanca', 'goya'
    )) passed++; else failed++

    // Test 2: Sin subzona (solo distrito + zona)
    if (await test(
      'madrid/barrio-de-salamanca (sin subzona)',
      'madrid/barrio-de-salamanca',
      'Barrio de Salamanca',
      'salamanca', 'barrio-salamanca', null
    )) passed++; else failed++

    // Test 3: Solo distrito
    if (await test(
      'madrid (solo municipio/distrito)',
      'madrid',
      null,
      null, null, null
    )) passed++; else failed++

    // Test 4: Slug inválido
    if (await test(
      'invalid/slug/notfound',
      'invalid/slug/notfound',
      null,
      null, null, null
    )) passed++; else failed++

    // Test 5: Chamberí + Vallehermoso
    if (await test(
      'madrid/chamberi/vallehermoso',
      'madrid/chamberi/vallehermoso',
      'Vallehermoso',
      'chamberi', null, 'vallehermoso'  // zona puede no resolverse, pero subzona sí
    )) passed++; else failed++

    // Test 6: Cache hit (misma llamada dos veces)
    console.log(`\n▶ Test: Cache hit (misma resolución dos veces)`)
    const beforeCache = cache.cache.size
    const res1 = await cache.resolveWithCache(client, 'madrid/barrio-de-salamanca', 'test')
    const afterFirstCall = cache.cache.size
    const res2 = await cache.resolveWithCache(client, 'madrid/barrio-de-salamanca', 'test')
    const afterSecondCall = cache.cache.size

    if (
      beforeCache < afterFirstCall &&
      afterFirstCall === afterSecondCall &&
      JSON.stringify(res1) === JSON.stringify(res2)
    ) {
      console.log(`  ✓ PASS (cache tamaño: ${beforeCache} → ${afterFirstCall} → ${afterSecondCall})`)
      passed++
    } else {
      console.log(`  ✗ FALLO (cache no funciona)`)
      failed++
    }

  } finally {
    await client.end()
  }

  console.log(`\n═══════════════════════════════════════════════════════════════`)
  console.log(`RESULTADO: ${passed} passed, ${failed} failed`)
  console.log(`═══════════════════════════════════════════════════════════════`)

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
