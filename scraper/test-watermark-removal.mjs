#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Test script para verificar que la limpieza de watermarks está funcionando
// ─────────────────────────────────────────────────────────────────────────────

import { cleanPhotoUrl, cleanPhotos } from './lib/watermark-removal.mjs'

const testUrls = [
  // Idealista URLs with WEB_DETAIL_TOP-L-L (watermarked)
  'https://img1.idealista.com/blur/WEB_DETAIL_TOP-L-L/12345678.jpg',
  'https://img2.idealista.com/blur/WEB_DETAIL_TOP-L-L/87654321.jpg',

  // Mobilia URLs
  'https://media.mobiliagestion.es/Images/ref123/photo.jpg',

  // Inmoweb URLs with thumb
  'https://example.com/imagenes/property-thumb.jpg',
]

console.log('🧪 TEST: Watermark Removal\n')
console.log('📋 Testing individual URLs:\n')

for (const url of testUrls) {
  const cleaned = cleanPhotoUrl(url, 'idealista')
  const changed = url !== cleaned ? '✅ CHANGED' : '⚠️  unchanged'
  console.log(`${changed}`)
  console.log(`  Original: ${url}`)
  console.log(`  Cleaned:  ${cleaned}`)
  console.log()
}

console.log('📋 Testing batch cleaning:\n')

const batch = testUrls
const cleaned = cleanPhotos(batch, 'idealista')
console.log(`  Input:  ${batch.length} URLs`)
console.log(`  Output: ${cleaned.length} URLs`)
console.log()
console.log('  Results:')
cleaned.forEach((url, i) => {
  console.log(`    [${i + 1}] ${url}`)
})
