# Platform HTML Structure Examples

Ejemplos reales (obfuscados) de cómo cada plataforma CRM estructura las fotos en HTML.

## 1. MOBILIA

### Estructura JS Object (Recomendado)
```html
<script type="text/javascript">
  var adInformation = {
    "adId": 1338678,
    "photos": [
      {
        "url": "https://media.mobiliagestion.es/Images/1338678/photo_001.jpg",
        "order": 1,
        "main": true,
        "description": "Living room"
      },
      {
        "url": "https://media.mobiliagestion.es/Images/1338678/photo_002.jpg",
        "order": 2,
        "main": false,
        "description": "Kitchen"
      },
      {
        "url": "https://media.mobiliagestion.es/Images/1338678/photo_003.jpg",
        "order": 3,
        "main": false
      }
    ]
  };
</script>
```

**Extracción:**
```javascript
const match = html.match(/var\s+adInformation\s*=\s*(\{[\s\S]*?\});/)
if (match) {
  const urls = []
  const objText = match[1]
  for (const m of objText.matchAll(/"url"\s*:\s*"([^"]+)"/g)) {
    urls.push(m[1])
  }
  // urls = ['https://media.mobiliagestion.es/Images/1338678/photo_001.jpg', ...]
}
```

### Estructura HTML (Alternativa)
```html
<div class="photo-gallery" id="photos-container">
  <div class="gallery-wrapper">
    <div class="slide-container">
      <img class="gallery-photo"
           data-original="https://media.mobiliagestion.es/Images/1338678/photo_001.jpg"
           src="https://media.mobiliagestion.es/Images/1338678/photo_001-thumb.jpg"
           alt="Living room" />
      <img class="gallery-photo"
           data-original="https://media.mobiliagestion.es/Images/1338678/photo_002.jpg"
           src="https://media.mobiliagestion.es/Images/1338678/photo_002-thumb.jpg"
           alt="Kitchen" />
    </div>
  </div>
</div>
```

**Extracción:**
```javascript
const urls = []
for (const m of html.matchAll(/data-original="([^"]+)"/g)) {
  urls.push(m[1])
}
```

### Con Picture (Responsivo)
```html
<picture class="property-image">
  <source media="(max-width: 600px)"
          srcset="https://media.mobiliagestion.es/Images/1338678/photo_001-small.jpg 600w,
                  https://media.mobiliagestion.es/Images/1338678/photo_001-medium.jpg 800w" />
  <source media="(min-width: 601px)"
          srcset="https://media.mobiliagestion.es/Images/1338678/photo_001.jpg 1200w,
                  https://media.mobiliagestion.es/Images/1338678/photo_001-large.jpg 1920w" />
  <img src="https://media.mobiliagestion.es/Images/1338678/photo_001.jpg" alt="Living room" />
</picture>
```

**Extracción:**
```javascript
const urls = new Set()
for (const m of html.matchAll(/srcset="([^"]+)"/g)) {
  const parts = m[1].split(',')
  for (const part of parts) {
    const url = part.trim().split(/\s+/)[0]
    urls.add(url)
  }
}
```

**Watermark Removal:**
```
Original:      https://media.mobiliagestion.es/Images/1338678/photo_001.jpg
Transformed:   https://media.mobiliagestion.es/Images/1338678/photo_001-original.jpg

Pattern:       \.jpg$ → -original.jpg
Regex:         /\.jpe?g(?=$|[?#])/i → replace with '-original.jpg'
```

---

## 2. INMOWEB

### JSON-LD Schema (Recomendado)
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@type": "RealEstateAgent",
  "name": "TerraHomes",
  "image": [
    "https://cdn.inmoweb.es/photos/property-4567/photo-1-full.jpg",
    "https://cdn.inmoweb.es/photos/property-4567/photo-2-full.jpg",
    "https://cdn.inmoweb.es/photos/property-4567/photo-3-full.jpg"
  ],
  "photo": {
    "@type": "ImageObject",
    "url": "https://cdn.inmoweb.es/photos/property-4567/photo-1-full.jpg"
  }
}
</script>
```

**Extracción:**
```javascript
const jsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
if (jsonMatch) {
  try {
    const schema = JSON.parse(jsonMatch[1])
    const urls = schema.image  // Array de URLs
  } catch (e) {
    // Fallback a regex si JSON inválido
  }
}
```

### Picture con Responsive Images
```html
<div class="gallery-container">
  <picture class="gallery-image">
    <source media="(max-width: 480px)"
            srcset="https://cdn.inmoweb.es/photos/property-4567/photo-1-small.jpg 480w,
                    https://cdn.inmoweb.es/photos/property-4567/photo-1-sm.jpg 600w" />
    <source media="(min-width: 481px) and (max-width: 1024px)"
            srcset="https://cdn.inmoweb.es/photos/property-4567/photo-1-medium.jpg 800w,
                    https://cdn.inmoweb.es/photos/property-4567/photo-1.jpg 1024w" />
    <source media="(min-width: 1025px)"
            srcset="https://cdn.inmoweb.es/photos/property-4567/photo-1-full.jpg 1440w,
                    https://cdn.inmoweb.es/photos/property-4567/photo-1-xl.jpg 1920w" />
    <img src="https://cdn.inmoweb.es/photos/property-4567/photo-1.jpg" 
         alt="Property image 1" />
  </picture>
</div>
```

**Extracción de srcset:**
```javascript
// srcset = "url1 480w, url2 600w, url3 800w"
const srcset = "https://cdn.inmoweb.es/photos/property-4567/photo-1-small.jpg 480w, https://cdn.inmoweb.es/photos/property-4567/photo-1-sm.jpg 600w"

const urls = srcset
  .split(',')
  .map(entry => entry.trim().split(/\s+/)[0])

// urls = [
//   'https://cdn.inmoweb.es/photos/property-4567/photo-1-small.jpg',
//   'https://cdn.inmoweb.es/photos/property-4567/photo-1-sm.jpg'
// ]
```

### Con Lazy-Loading
```html
<div class="photo-gallery">
  <img loading="lazy"
       data-src="https://cdn.inmoweb.es/photos/property-4567/photo-1.jpg"
       src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCBmaWxsPSIjZDNkM2QzIiB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIvPjwvc3ZnPg=="
       alt="Property image 1" />
  <img loading="lazy"
       data-src="https://cdn.inmoweb.es/photos/property-4567/photo-2.jpg"
       src="data:image/svg+xml..."
       alt="Property image 2" />
</div>
```

**Extracción:**
```javascript
const urls = []
for (const m of html.matchAll(/data-src="([^"]+)"/g)) {
  urls.push(m[1])
}
```

**Watermark Removal:**
```
Original:      https://cdn.inmoweb.es/photos/property-4567/photo-1-small.jpg
Transformed:   https://cdn.inmoweb.es/photos/property-4567/photo-1.jpg

Patterns:
  -small      → remove
  -sm         → remove
  -thumb      → remove
  -mini       → remove
  /thumbs/    → remove directory
```

---

## 3. LEVEL

### Objeto JavaScript (Embebido)
```html
<script type="text/javascript">
  window.propertyData = {
    "id": 8910,
    "title": "Apartamento en zona céntrica",
    "gallery": {
      "images": [
        {
          "thumb": "https://level.es/media/property-8910-thumb.jpg",
          "full": "https://level.es/media/property-8910-full.jpg",
          "title": "Living room"
        },
        {
          "thumb": "https://level.es/media/property-8911-thumb.jpg",
          "full": "https://level.es/media/property-8911-full.jpg",
          "title": "Bedroom"
        }
      ]
    }
  };
</script>
```

**Extracción:**
```javascript
const jsMatch = html.match(/window\.propertyData\s*=\s*(\{[\s\S]*?\});/)
if (jsMatch) {
  const urls = []
  const objText = jsMatch[1]
  for (const m of objText.matchAll(/"full"\s*:\s*"([^"]+)"/g)) {
    urls.push(m[1])
  }
}
```

### Data Attributes (Moderno)
```html
<div class="gallery-container">
  <div class="gallery-item" 
       data-image="https://level.es/media/property-8910-full.jpg"
       data-thumb="https://level.es/media/property-8910-thumb.jpg"
       data-title="Living room">
    <img src="https://level.es/media/property-8910-thumb.jpg" 
         alt="Living room" />
  </div>
  <div class="gallery-item"
       data-image="https://level.es/media/property-8911-full.jpg"
       data-thumb="https://level.es/media/property-8911-thumb.jpg"
       data-title="Bedroom">
    <img src="https://level.es/media/property-8911-thumb.jpg"
         alt="Bedroom" />
  </div>
</div>
```

**Extracción:**
```javascript
const urls = []
for (const m of html.matchAll(/data-image="([^"]+)"/g)) {
  urls.push(m[1])
}
```

### Picture Responsivo
```html
<picture class="property-image">
  <source media="(max-width: 768px)"
          srcset="https://level.es/media/property-8910-mobile.jpg 400w,
                  https://level.es/media/property-8910-tablet.jpg 600w" />
  <source media="(min-width: 769px)"
          srcset="https://level.es/media/property-8910-full.jpg 1000w,
                  https://level.es/media/property-8910-full-hd.jpg 1920w" />
  <img src="https://level.es/media/property-8910-full.jpg" alt="Property" />
</picture>
```

**Nota:** Level está construido sobre Mobilia, así que el almacenamiento también es `media.mobiliagestion.es` en muchos casos.

---

## 4. FOTOCASA

### JSON-LD Schema (Principal)
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@type": "RealEstateAgent",
  "name": "Fotocasa",
  "image": [
    "https://images.ixpimg.com/portfolio/12345/1/1000x750/image1.jpg",
    "https://images.ixpimg.com/portfolio/12345/2/1000x750/image2.jpg",
    "https://images.ixpimg.com/portfolio/12345/3/1000x750/image3.jpg"
  ],
  "photo": {
    "@type": "ImageObject",
    "url": "https://images.ixpimg.com/portfolio/12345/1/1000x750/image1.jpg"
  }
}
</script>
```

**Extracción:**
```javascript
const jsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
if (jsonMatch) {
  const schema = JSON.parse(jsonMatch[1])
  const urls = schema.image.map(url => 
    url.replace(/\/\d+x\d+\//, '/original/')  // Normalizar a original
  )
}
```

### Picture Responsivo (Moderno)
```html
<picture class="gallery-image">
  <source media="(max-width: 480px)"
          srcset="https://images.ixpimg.com/portfolio/12345/1/480x360/image1.jpg 1x,
                  https://images.ixpimg.com/portfolio/12345/1/960x720/image1.jpg 2x" />
  <source media="(min-width: 481px)"
          srcset="https://images.ixpimg.com/portfolio/12345/1/1000x750/image1.jpg,
                  https://images.ixpimg.com/portfolio/12345/1/2000x1500/image1.jpg 2x" />
  <img class="gallery-image"
       src="https://images.ixpimg.com/portfolio/12345/1/1000x750/image1.jpg"
       alt="Property image 1" />
</picture>
```

**Extracción:**
```javascript
// Fotocasa usa ixpimg con tamaños en la ruta
// /100x75/, /480x360/, /1000x750/, /original/

const urls = new Set()

// Desde srcset
for (const m of html.matchAll(/srcset="([^"]+)"/g)) {
  const srcset = m[1]
  const parts = srcset.split(',')
  for (const part of parts) {
    const url = part.trim().split(/\s+/)[0]
    urls.add(normalizeIxpimgUrl(url))
  }
}

function normalizeIxpimgUrl(url) {
  // Remover query params
  url = url.split('?')[0]
  // Preferir 1000x750
  if (!url.includes('/original/')) {
    url = url.replace(/\/\d+x\d+\//, '/1000x750/')
  }
  return url
}
```

### Next.js __NEXT_DATA__ (SPA)
```html
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "property": {
        "id": "prop-12345",
        "images": [
          {
            "url": "https://images.ixpimg.com/portfolio/12345/1/1000x750/image1.jpg",
            "caption": "Sala de estar"
          },
          {
            "url": "https://images.ixpimg.com/portfolio/12345/2/1000x750/image2.jpg",
            "caption": "Cocina"
          }
        ]
      }
    }
  }
}
</script>
```

**Extracción:**
```javascript
const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)
if (nextDataMatch) {
  const data = JSON.parse(nextDataMatch[1])
  const urls = data.props.pageProps.property.images.map(img => img.url)
}
```

**Watermark Removal:**
```
Original:      https://images.ixpimg.com/portfolio/12345/1/100x75/image1.jpg
Transformed:   https://images.ixpimg.com/portfolio/12345/1/1000x750/image1.jpg

Pattern:       /\d+x\d+/ → /1000x750/ (tamaño estándar)
```

---

## Comparativa de Estructura

| Aspecto | Mobilia | Inmoweb | Level | Fotocasa |
|---------|---------|---------|-------|----------|
| **JS Object** | ✅ `adInformation` | ⚠️ Ocasional | ✅ `propertyData` | ⚠️ `__NEXT_DATA__` |
| **JSON-LD** | ❌ No | ✅ `ld+json` | ❌ No | ✅ `ld+json` |
| **Picture/srcset** | ✅ | ✅ | ✅ | ✅ |
| **Data-attributes** | ✅ `data-original` | ⚠️ `data-src` | ✅ `data-image` | ⚠️ Raro |
| **Lazy-loading** | ⚠️ Ocasional | ✅ Común | ⚠️ Ocasional | ✅ Común |

---

## Testing HTML

### Para MOBILIA
```html
<script type="text/javascript">
  var adInformation = {
    "photos": [
      {"url": "https://media.mobiliagestion.es/Images/123/test.jpg", "order": 1}
    ]
  };
</script>
```

### Para INMOWEB
```html
<picture>
  <source srcset="https://cdn.example.es/photos/property-4567/photo-1.jpg 1000w" />
  <img src="https://cdn.example.es/photos/property-4567/photo-1.jpg" />
</picture>
```

### Para LEVEL
```html
<div data-image="https://level.es/media/property-8910-full.jpg">
  <img src="https://level.es/media/property-8910-thumb.jpg" />
</div>
```

### Para FOTOCASA
```html
<script type="application/ld+json">
{
  "image": ["https://images.ixpimg.com/portfolio/12345/1/1000x750/image1.jpg"]
}
</script>
```

---

## Cambios Comunes en la Estructura

### Cambio: CDN o dominio de fotos
Todas las plataformas pueden cambiar sus CDNs. Monitorear:
- Mobilia: `media.mobiliagestion.es`
- Inmoweb: variable por agencia
- Level: `level.es` o `media.mobiliagestion.es`
- Fotocasa: `ixpimg.com` (antes `static.fotocasa.es`)

### Cambio: Atributos HTML
Si `data-original` desaparece, intentar `data-src`, `src`, `srcset` en ese orden.

### Cambio: Lazy-loading
Antiguos sitios tienen `src` directo; modernos usan `data-src` o `loading="lazy"`.

---

**Última actualización:** June 19, 2026  
**Notas:** Ejemplos obfuscados para privacidad. URLs reales disponibles en testing.
