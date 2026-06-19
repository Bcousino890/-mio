// ─────────────────────────────────────────────────────────────────────────────
// Test CRM Photo Extractors
// Verifica que las funciones de extracción de fotos funcionan correctamente
// ─────────────────────────────────────────────────────────────────────────────

import {
  extractPhotosFromMobilia,
  extractPhotosFromInmoweb,
  extractPhotosFromLevel,
  extractPhotosFromFotocasa,
} from './lib/crm-photo-extractors.mjs'

const TESTS = [
  {
    name: 'Mobilia - Extrae fotos con data-original',
    extractor: extractPhotosFromMobilia,
    baseUrl: 'https://www.housingo.es/Mobilia/VerInmueble/1338678/Ficha.html',
    html: `
      <div class="gallery">
        <img src="https://media.mobiliagestion.es/Images/1338678/photo1.jpg"
             data-original="https://media.mobiliagestion.es/Images/1338678/photo1-original.jpg">
        <img src="https://media.mobiliagestion.es/Images/1338678/photo2.jpg"
             data-original="https://media.mobiliagestion.es/Images/1338678/photo2-original.jpg">
      </div>
    `,
    expectedCount: 2,
    expectedHosts: ['media.mobiliagestion.es'],
    expectedTransform: 'original'
  },
  {
    name: 'Mobilia - Fallback a src si no hay data-original',
    extractor: extractPhotosFromMobilia,
    baseUrl: 'https://www.housingo.es/Mobilia/VerInmueble/999999/',
    html: `
      <div class="gallery">
        <img src="https://media.mobiliagestion.es/Images/999999/living.jpg">
        <img src="https://media.mobiliagestion.es/Images/999999/kitchen.jpg">
      </div>
    `,
    expectedCount: 2,
    expectedHosts: ['media.mobiliagestion.es']
  },
  {
    name: 'Mobilia - Filtra URLs de Flags',
    extractor: extractPhotosFromMobilia,
    baseUrl: 'https://www.housingo.es/Mobilia/VerInmueble/1338678/',
    html: `
      <div class="gallery">
        <img src="https://media.mobiliagestion.es/Images/1338678/photo1.jpg">
        <img src="https://media.mobiliagestion.es/Flags/es.png">
        <img src="https://media.mobiliagestion.es/Images/1338678/photo2.jpg">
      </div>
    `,
    expectedCount: 2,
    shouldNotContain: ['Flags']
  },
  {
    name: 'Inmoweb - Extrae desde picture/source srcset',
    extractor: extractPhotosFromInmoweb,
    baseUrl: 'https://www.tuagencia.es/inmuebles/4567/',
    html: `
      <picture>
        <source srcset="https://www.tuagencia.es/images/4567/photo1.jpg 1x,
                        https://www.tuagencia.es/images/4567/photo1@2x.jpg 2x">
        <source srcset="https://www.tuagencia.es/fotos/4567/large.jpg">
        <img src="https://www.tuagencia.es/images/4567/photo1.jpg">
      </picture>
    `,
    expectedCount: 3,
    expectedHosts: ['tuagencia.es']
  },
  {
    name: 'Inmoweb - Remueve sufijos de thumbnail',
    extractor: extractPhotosFromInmoweb,
    baseUrl: 'https://remax.es/inmuebles/789/',
    html: `
      <picture>
        <source srcset="https://remax.es/images/789/photo-thumb.jpg">
      </picture>
      <img data-src="https://remax.es/galeria/789/image-small.jpg">
      <img data-src="https://remax.es/photos/789/room-thumbnail.jpg">
    `,
    expectedCount: 3,
    shouldNotContain: ['-thumb', '-small', '-thumbnail'],
    verifyTransform: true
  },
  {
    name: 'Inmoweb - Extrae de lightbox links',
    extractor: extractPhotosFromInmoweb,
    baseUrl: 'https://agencia.es/inmuebles/123/',
    html: `
      <a href="https://agencia.es/galeria/123/room1-large.jpg" class="gallery">
        <img src="https://agencia.es/galeria/123/room1-thumb.jpg">
      </a>
      <a href="https://agencia.es/galeria/123/room2-large.jpg" class="lightbox">
        <img src="https://agencia.es/galeria/123/room2-thumb.jpg">
      </a>
    `,
    expectedCount: 2,
    expectedHosts: ['agencia.es']
  },
  {
    name: 'Level - Delega a Mobilia',
    extractor: extractPhotosFromLevel,
    baseUrl: 'https://www.agencia.es/property-ref-555555/listing/',
    html: `
      <div class="gallery">
        <img data-original="https://media.mobiliagestion.es/Images/555555/photo1.jpg">
        <img data-original="https://media.mobiliagestion.es/Images/555555/photo2.jpg">
      </div>
    `,
    expectedCount: 2,
    expectedHosts: ['media.mobiliagestion.es']
  },
  {
    name: 'Level - Filtra por referencia correcta',
    extractor: extractPhotosFromLevel,
    baseUrl: 'https://www.agencia.es/property-ref-555555/listing/',
    html: `
      <div class="gallery">
        <img src="https://media.mobiliagestion.es/Images/555555/photo1.jpg">
        <img src="https://media.mobiliagestion.es/Images/999999/photo.jpg">
      </div>
    `,
    expectedCount: 1,
    shouldContainRef: '555555'
  },
  {
    name: 'Fotocasa - Extrae desde picture/source',
    extractor: extractPhotosFromFotocasa,
    baseUrl: 'https://www.agencia.es/casa/prop-12345/',
    html: `
      <picture>
        <source srcset="https://static.fotocasa.es/images/ads/12345/photo1.jpg 1x">
        <source srcset="https://ixpimg.com/v1/PAD0aHaA_z.jpg">
      </picture>
    `,
    expectedCount: 2,
    expectedHosts: ['static.fotocasa.es', 'ixpimg.com']
  },
  {
    name: 'Fotocasa - Normaliza variantes de tamaño',
    extractor: extractPhotosFromFotocasa,
    baseUrl: 'https://www.agencia.es/casa/prop-12345/',
    html: `
      <img src="https://static.fotocasa.es/images/ads/12345/photo.jpg?rule=web_412x257">
      <img src="https://ixpimg.com/v1/12345.jpg?rule=web_600x400">
    `,
    expectedCount: 2,
    shouldNotContain: ['rule=web_']
  },
  {
    name: 'Fotocasa - Extrae de __NEXT_DATA__',
    extractor: extractPhotosFromFotocasa,
    baseUrl: 'https://www.agencia.es/casa/prop-12345/',
    html: `
      <script id="__NEXT_DATA__" type="application/json">
      {"props":{"pageProps":{"realEstate":{"multimedias":[
        {"url":"https://static.fotocasa.es/images/client/12345/room1.jpg"},
        {"url":"https://ixpimg.com/v2/abc123.jpg"}
      ]}}}}
      </script>
    `,
    expectedCount: 2,
    expectedHosts: ['static.fotocasa.es', 'ixpimg.com']
  },
  {
    name: 'Fotocasa - Filtra URLs no de propiedades',
    extractor: extractPhotosFromFotocasa,
    baseUrl: 'https://www.agencia.es/casa/prop-12345/',
    html: `
      <img src="https://static.fotocasa.es/images/ads/12345/photo.jpg">
      <img src="https://static.fotocasa.es/images/logo.png">
      <img src="https://static.fotocasa.es/images/banner.jpg">
    `,
    expectedCount: 1,
    shouldNotContain: ['logo', 'banner']
  },
  {
    name: 'All - Maneja HTML vacío',
    testAll: true,
    baseUrl: 'https://example.com/',
    html: '',
    expectedCount: 0
  },
  {
    name: 'All - Maneja HTML nulo',
    testAll: true,
    baseUrl: 'https://example.com/',
    html: null,
    expectedCount: 0
  },
]

function runTest(test) {
  const extractors = test.testAll
    ? { Mobilia: extractPhotosFromMobilia, Inmoweb: extractPhotosFromInmoweb, Level: extractPhotosFromLevel, Fotocasa: extractPhotosFromFotocasa }
    : { [test.extractor.name.replace('extractPhotosFrom', '')]: test.extractor }

  const results = []

  for (const [name, extractor] of Object.entries(extractors)) {
    try {
      const photos = extractor(test.html, test.baseUrl)

      // Verificar conteo
      if (photos.length !== test.expectedCount) {
        results.push({
          ok: false,
          reason: `Expected ${test.expectedCount} photos, got ${photos.length}`,
          photos
        })
        continue
      }

      // Verificar hosts
      if (test.expectedHosts) {
        const allValid = photos.every(url => test.expectedHosts.some(host => url.includes(host)))
        if (!allValid) {
          results.push({
            ok: false,
            reason: `Not all photos are from expected hosts: ${test.expectedHosts.join(', ')}`,
            photos
          })
          continue
        }
      }

      // Verificar que NO contiene ciertos strings
      if (test.shouldNotContain) {
        const hasExcluded = photos.some(url => test.shouldNotContain.some(ex => url.includes(ex)))
        if (hasExcluded) {
          results.push({
            ok: false,
            reason: `Photos contain excluded strings: ${test.shouldNotContain.join(', ')}`,
            photos
          })
          continue
        }
      }

      // Verificar transformación (que -original está en la URL)
      if (test.expectedTransform) {
        const allTransformed = photos.every(url => url.includes(test.expectedTransform))
        if (!allTransformed) {
          results.push({
            ok: false,
            reason: `Not all photos were transformed (missing '${test.expectedTransform}')`,
            photos
          })
          continue
        }
      }

      // Verificar transformación de thumbnail removal
      if (test.verifyTransform) {
        const hasThumb = photos.some(url => url.includes('-thumb') || url.includes('-small') || url.includes('-thumbnail'))
        if (hasThumb) {
          results.push({
            ok: false,
            reason: 'Thumbnails were not properly removed',
            photos
          })
          continue
        }
      }

      // Verificar que contiene cierta referencia
      if (test.shouldContainRef) {
        const allValid = photos.every(url => url.includes(test.shouldContainRef))
        if (!allValid) {
          results.push({
            ok: false,
            reason: `Not all photos contain reference ${test.shouldContainRef}`,
            photos
          })
          continue
        }
      }

      results.push({ ok: true, photos })
    } catch (err) {
      results.push({
        ok: false,
        reason: `Exception: ${err.message}`,
        stack: err.stack
      })
    }
  }

  return results
}

// Ejecutar pruebas
let passed = 0, failed = 0

console.log('\n' + '='.repeat(80))
console.log('CRM Photo Extractors - Test Suite')
console.log('='.repeat(80) + '\n')

for (const test of TESTS) {
  const results = runTest(test)

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const extractorName = test.testAll
      ? Object.keys({ Mobilia: null, Inmoweb: null, Level: null, Fotocasa: null })[i]
      : test.extractor.name.replace('extractPhotosFrom', '')

    const status = result.ok ? '✓' : '✗'
    const testName = test.testAll ? `${test.name} (${extractorName})` : test.name

    console.log(`${status} ${testName}`)

    if (!result.ok) {
      console.log(`  → ${result.reason}`)
      if (result.photos && result.photos.length > 0) {
        console.log(`  Extracted: ${result.photos.slice(0, 2).join(', ')}${result.photos.length > 2 ? '...' : ''}`)
      }
      failed++
    } else {
      if (result.photos && result.photos.length > 0) {
        console.log(`  → Extracted ${result.photos.length} photo(s)`)
      }
      passed++
    }
  }
}

console.log('\n' + '='.repeat(80))
console.log(`Results: ${passed} passed, ${failed} failed`)
console.log('='.repeat(80) + '\n')

process.exit(failed > 0 ? 1 : 0)
