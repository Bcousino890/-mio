#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Test script para verificar extracción de fotos y vídeos desde HTML de Idealista
// ─────────────────────────────────────────────────────────────────────────────

import { parseDetailPage } from './lib/parse.mjs'

// Mock HTML de Idealista con fotos, vídeos y tours 3D
const mockHTML = `
<!DOCTYPE html>
<html>
<head>
<title>Piso en venta en Calle Alcalá — idealista</title>
</head>
<body>
<script>
var config = {
  adProfessionalName: "Engel & Völkers",
  adCommercialName: null,
  addressVisibility: "EXACT"
};

var adMultimediasInfo = {
  picturesWithoutPlans: [
    { imageDataService: "https://img1.idealista.com/blur/WEB_DETAIL_TOP-L-L/12345678.jpg" },
    { imageDataService: "https://img1.idealista.com/blur/WEB_DETAIL_TOP-L-L/12345679.jpg" },
    { imageDataService: "https://img1.idealista.com/blur/WEB_DETAIL_TOP-L-L/12345680.jpg" }
  ],
  videos: [
    { url: "https://www.youtube.com/embed/dQw4w9WgXcQ" },
    { videoUrl: "https://player.vimeo.com/video/123456789" }
  ],
  visit3DTour: [
    { url: "https://my.matterport.com/show/?m=abcdef123456" }
  ]
};
</script>

<div class="price">2.100.000</div>
<div>
  <li>137 m² construidos</li>
  <li>3 habitaciones</li>
  <li>3 baños</li>
</div>

<title>Piso en venta en Calle Alcalá, Madrid — idealista</title>

<div id="headerMap">
  <li class="header-map-list">Calle Alcalá, 123</li>
  <li class="header-map-list">Barrio Salamanca</li>
  <li class="header-map-list">Distrito Centro</li>
</ul>
</div>

<img alt="Engel & Völkers" class="logo-branding" title="Engel & Völkers">

<div class="adCommentsLanguage">
  Piso completamente equipado con electrodomésticos y una magnífica vinoteca.
</div>

<img src="https://maps.googleapis.com/maps/api/staticmap?center=40.4189,-3.6919&zoom=15" />

<div class="txt-ref">W-0462UX</div>

<span class="icon-energy-c-b">B</span>
<span class="icon-energy-c-a">A</span>

<div class="energy-certificate-img"><img src="https://idealistaphotos.s3.amazonaws.com/cee/sample.jpg" /></div>

<strong>1.234</strong><span>visitas</span>
<strong>56</strong><span>contactos por email</span>
<strong>23</strong><span>veces guardado</span>

<iframe src="https://www.youtube.com/embed/yC6RYb3VWqY"></iframe>
<iframe src="https://player.vimeo.com/video/987654321"></iframe>
<iframe src="https://my.matterport.com/show/?m=xyz123abc"></iframe>

Anuncio actualizado el 5 de junio de 2025
</body>
</html>
`;

async function test() {
  console.log('🧪 TEST: Photo and Video Extraction\n')

  const result = await parseDetailPage(mockHTML, '12345678')

  console.log('📸 PHOTOS EXTRACTED:')
  console.log(`   Count: ${result.photos.length}`)
  result.photos.forEach((url, i) => {
    const hasWatermark = url.includes('WEB_DETAIL_TOP-L-L') ? '⚠️ ' : '✅'
    console.log(`   [${i + 1}] ${hasWatermark} ${url}`)
  })

  console.log('\n🎬 VIDEOS EXTRACTED:')
  console.log(`   Count: ${result.videos.length}`)
  result.videos.forEach((url, i) => {
    console.log(`   [${i + 1}] ${url}`)
  })

  console.log('\n🌐 VIRTUAL TOURS EXTRACTED:')
  console.log(`   Count: ${result.virtual_tours.length}`)
  result.virtual_tours.forEach((url, i) => {
    console.log(`   [${i + 1}] ${url}`)
  })

  console.log('\n📊 OTHER DETAILS:')
  console.log(`   Title: ${result.title}`)
  console.log(`   Price: €${result.price}`)
  console.log(`   Bedrooms: ${result.bedrooms}`)
  console.log(`   Bathrooms: ${result.bathrooms}`)
  console.log(`   Square Meters: ${result.square_meters}`)
  console.log(`   Address: ${result.address}`)
  console.log(`   Advertiser: ${result.advertiser_name} (${result.advertiser_type})`)
  console.log(`   Days on Market: ${result.days_on_market}`)
  console.log(`   Stats: Views=${result.stats?.views}, Emails=${result.stats?.email_contacts}, Favorites=${result.stats?.favorites}`)
}

test().catch(e => {
  console.error('❌ Error:', e.message)
  process.exit(1)
})
