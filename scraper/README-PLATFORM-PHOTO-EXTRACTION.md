# Extracción de Fotos en Plataformas CRM Inmobiliarias

Guía técnica para localizar, extraer y procesar fotos de inmuebles en las 4 plataformas CRM más usadas en España.

---

## 1. MOBILIA

**Dominios típicos:** housingo.es, level-real-estate.es, inmobiliariotenerife.es  
**URL de anuncio:** `https://www.housingo.es/Mobilia/VerInmueble/1338678/Ficha.html`  
**Tipo de almacenamiento:** CDN propio + archivos embebidos en HTML

### 1.1 Estructura HTML de Fotos

#### Opción A: JavaScript embebido (Método más robusto)

```html
<script type="text/javascript">
  var adInformation = {
    "photos": [
      {
        "url": "https://media.mobiliagestion.es/Images/1338678/photo_1.jpg",
        "order": 1,
        "main": true
      },
      {
        "url": "https://media.mobiliagestion.es/Images/1338678/photo_2.jpg",
        "order": 2
      }
    ]
  };
</script>
```

**Selectores / Patrones:**
- **Regex para extraer objeto JS:** `/var\s+adInformation\s*=\s*(\{[\s\S]*?\});/`
- **Regex para URLs dentro del objeto:** `/"url"\s*:\s*"([^"]+media\.mobiliagestion\.es[^"]*)"/g`
- **Extracción JSON:** Parsear el objeto `adInformation.photos[]` y acceder a `.url`

#### Opción B: Atributos HTML (Método alternativo)

```html
<div class="photo-gallery" id="photos-container">
  <img data-photo-url="https://media.mobiliagestion.es/Images/1338678/photo_1.jpg"
       class="gallery-photo" 
       alt="Foto principal" />
  <img data-photo-url="https://media.mobiliagestion.es/Images/1338678/photo_2.jpg"
       class="gallery-photo" />
</div>
```

**Selectores CSS:**
- `img.gallery-photo` → atributo `data-photo-url`
- `[data-photo-url]` → selecciona todos los elementos con URLs de foto
- Regex: `/data-photo-url="([^"]+)"/g`

#### Opción C: etiqueta `<source>` en elementos `<picture>`

```html
<picture>
  <source srcset="https://media.mobiliagestion.es/Images/1338678/photo-thumb.jpg" media="(max-width: 600px)" />
  <img src="https://media.mobiliagestion.es/Images/1338678/photo.jpg" alt="Foto" />
</picture>
```

**Selectores:**
- `picture > source` → atributo `srcset`
- `picture > img` → atributo `src`
- Regex para extraer URLs: `/(https?:\/\/[^"\s]+\.jpe?g)/gi`

### 1.2 Formato de URL

```
Patrón: https://media.mobiliagestion.es/Images/{ref_id}/{photo_name}.jpg
Ejemplos:
  - https://media.mobiliagestion.es/Images/1338678/photo_1.jpg
  - https://media.mobiliagestion.es/Images/1338678/living-room.jpg
  - https://media.mobiliagestion.es/Images/1338678/exterior-10.jpg

Variantes con marca de agua:
  - URL original:        .../photo.jpg              (con marca de agua Mobilia)
  - URL sin marca agua:  .../photo-original.jpg     (transformación a aplicar)
```

### 1.3 Galería y Múltiples Fotos

**Estructura típica:**
- Array de objetos `adInformation.photos[]`
- Cada objeto: `{ url, order, main, description (optional) }`
- Máximo: 40-50 fotos por anuncio
- Primera foto = foto principal (usualmente `main: true`)

**Extracción:**
```javascript
// Regex compilado para máxima eficiencia
const photoRegex = /"url"\s*:\s*"([^"]*media\.mobiliagestion\.es[^"]*)"/g
const urls = []
let match
while ((match = photoRegex.exec(htmlContent)) !== null) {
  urls.push(match[1])
}
```

### 1.4 Marca de Agua y Transformaciones

**Mobilia agrega un watermark (logo + borde) a las fotos:**
- **Versión con marca:** `/Images/{id}/photo.jpg`
- **Versión limpia:** `/Images/{id}/photo-original.jpg`

**Transformación a aplicar:**
```regex
\.jpe?g(?=$|[?#]) → -original.jpg

Ejemplo:
  Input:  https://media.mobiliagestion.es/Images/1338678/photo.jpg
  Output: https://media.mobiliagestion.es/Images/1338678/photo-original.jpg
```

**Notas:**
- La variante `-original.jpg` es **100% confiable** si existe en Mobilia
- Aplicar SOLO a URLs con `/Images/` (rechazar `/Flags/` que son logos)
- La transformación se realiza en `watermark-removal.mjs`: función `cleanMobiliaImage()`

### 1.5 Selectores CSS Exactos (si fuera necesario)

```css
/* Galería principal */
.photo-gallery
.gallery-photo
.gallery-container img
#photos-container img

/* Miniaturas */
.thumbnail-strip img
.photo-list li img
.carousel-item img
```

### 1.6 Patrón Regex Compilado Recomendado

```javascript
// Extrae todas las URLs de fotos Mobilia del HTML
const MOBILIA_PHOTO_REGEX = /(?:
  "url"\s*:\s*"([^"]*media\.mobiliagestion\.es\/Images[^"]*)"|
  data-photo-url="([^"]*media\.mobiliagestion\.es[^"]*)"|
  src="([^"]*media\.mobiliagestion\.es[^"]*)"|
  srcset="([^"]*media\.mobiliagestion\.es[^"]*)"
)/gix

// Uso
const urls = []
let match
while ((match = MOBILIA_PHOTO_REGEX.exec(html)) !== null) {
  const url = match[1] || match[2] || match[3] || match[4]
  if (url && !urls.includes(url)) urls.push(url)
}
```

---

## 2. INMOWEB

**Dominios típicos:** terrahoma.es, tuagencia.es, agenciamultiservicios.es  
**URL de anuncio:** `https://www.tuagencia.es/inmuebles/4567/`  
**Tipo de almacenamiento:** Multi-tenant CDN + almacenamiento distribuido

### 2.1 Estructura HTML de Fotos

#### Opción A: JSON embebido en `<script type="application/ld+json">`

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@type": "RealEstateAgent",
  "image": [
    "https://cdn.inmoweb.es/photos/property-4567/photo-1.jpg",
    "https://cdn.inmoweb.es/photos/property-4567/photo-2.jpg"
  ],
  "photo": {
    "url": "https://cdn.inmoweb.es/photos/property-4567/main.jpg"
  }
}
</script>
```

**Selectores:**
- `script[type="application/ld+json"]` → parsear como JSON
- Array `image[]` → URLs de fotos
- Campo `photo.url` → foto principal

#### Opción B: Estructura HTML común (imagen responsiva)

```html
<div class="property-gallery">
  <picture>
    <source media="(max-width: 768px)"
            srcset="https://cdn.inmoweb.es/photos/property-4567/photo-1-thumb.jpg 600w,
                    https://cdn.inmoweb.es/photos/property-4567/photo-1-sm.jpg 800w" />
    <source media="(min-width: 769px)"
            srcset="https://cdn.inmoweb.es/photos/property-4567/photo-1.jpg 1200w,
                    https://cdn.inmoweb.es/photos/property-4567/photo-1-lg.jpg 1920w" />
    <img src="https://cdn.inmoweb.es/photos/property-4567/photo-1.jpg" alt="Photo 1" />
  </picture>
</div>
```

**Selectores CSS:**
- `.property-gallery picture` → galerías de fotos
- `img[src*="photos"]` → todas las imágenes de propiedades
- `picture > source[srcset]` → URLs responsivas
- Regex: `/srcset="([^"]+)"/g` → parsear `URL1 600w, URL2 800w` → extraer URLs

#### Opción C: Atributos data-* (Más moderno)

```html
<div class="gallery" data-photos='["https://cdn.inmoweb.es/photos/4567/p1.jpg","https://cdn.inmoweb.es/photos/4567/p2.jpg"]'>
  <img data-src="https://cdn.inmoweb.es/photos/4567/p1.jpg" alt="Photo" class="lazy-load" />
</div>
```

**Selectores:**
- `[data-photos]` → JSON array como atributo
- `[data-src]` → URLs para lazy-loading
- Regex para parsear JSON: `data-photos='(\[[^\]]+\])'`

### 2.2 Formato de URL

```
Patrones típicos:
  https://cdn.inmoweb.es/photos/property-{id}/photo-{n}.jpg
  https://images.inmoweb.es/properties/{id}/photo-{n}.jpg
  https://storage.inmoweb.es/uploads/property-{id}/{filename}.jpg
  https://www.tuagencia.es/uploads/fotos/inmueble-{id}/{filename}.jpg
  
Con modificadores de tamaño:
  -thumb.jpg     → thumbnail pequeño (< 300px)
  -sm.jpg        → pequeño (300-600px)
  -md.jpg        → mediano (600-900px)  
  -lg.jpg        → grande (900-1200px)
  
  O sufijos alternativos:
  /thumbnail/    → ruta con miniatura
  /thumbs/       → directorio de miniaturas
  -small
  -mini
  -preview

Ejemplo real:
  https://cdn.inmoweb.es/photos/property-4567/photo-1-thumb.jpg
  https://cdn.inmoweb.es/photos/property-4567/photo-1.jpg       ← versión limpia
```

### 2.3 Galería y Múltiples Fotos

**Estructura típica:**
- Array en JSON: `image[]` o `photos[]`
- Cada entrada es una URL completa
- Máximo: 30-50 fotos por anuncio
- Responsivas con múltiples variantes de tamaño en `srcset`

**Extracción:**
```javascript
// Opción 1: Desde JSON embebido
const ldJsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
if (ldJsonMatch) {
  const schema = JSON.parse(ldJsonMatch[1])
  const urls = schema.image || []
}

// Opción 2: Desde srcset
const srcsetMatches = [...html.matchAll(/srcset="([^"]+)"/g)]
const urls = []
for (const match of srcsetMatches) {
  // "url1 600w, url2 800w" → extraer solo URLs
  const parts = match[1].split(',')
  for (const part of parts) {
    const url = part.trim().split(/\s+/)[0]
    if (url && !urls.includes(url)) urls.push(url)
  }
}

// Opción 3: Desde data-photos
const dataPhotosMatch = html.match(/data-photos='(\[[^\]]+\])'/)
if (dataPhotosMatch) {
  const urls = JSON.parse(dataPhotosMatch[1])
}
```

### 2.4 Marca de Agua y Transformaciones

**Inmoweb no agrega marca de agua agresiva**, pero sí ofrece múltiples tamaños.

**Transformación a aplicar:**
```regex
Eliminar sufijos de tamaño:

  /-thumb(?=\.jpe?g)  → nada
  /-thumbnail(?=\.)   → nada
  /\/thumbs\//        → nada
  /-small(?=\.)       → nada
  /-sm(?=\.)          → nada
  /-mini(?=\.)        → nada
  /-preview(?=\.)     → nada

Ejemplo:
  Input:  https://cdn.inmoweb.es/photos/property-4567/photo-1-thumb.jpg
  Output: https://cdn.inmoweb.es/photos/property-4567/photo-1.jpg
```

**Implementación:**
```javascript
const INMOWEB_THUMB_PATTERNS = [
  /\/thumbs\//i,
  /\/thumbnail\//i,
  /-thumb(?=\.[a-z]+(?:$|[?#]))/i,
  /-thumbnail(?=\.[a-z]+(?:$|[?#]))/i,
  /[-_]small(?=\.[a-z]+(?:$|[?#]))/i,
  /[-_]sm(?=\.[a-z]+(?:$|[?#]))/i,
  /[-_]mini(?=\.[a-z]+(?:$|[?#]))/i,
]

function cleanInmowebImage(url) {
  let out = url
  for (const pattern of INMOWEB_THUMB_PATTERNS) {
    if (pattern.test(out)) {
      out = out.replace(pattern, '')
    }
  }
  return out
}
```

### 2.5 Selectores CSS Exactos

```css
.property-gallery
.gallery-container
.photo-slider img
.image-carousel img
img.property-photo
[data-photos]
[data-src*="photos"]
picture > source[srcset]
```

### 2.6 Patrón Regex Compilado Recomendado

```javascript
// Extrae URLs de Inmoweb en múltiples formatos
const INMOWEB_PHOTO_REGEX = /(?:
  "image"\s*:\s*(\[[^\]]*\])|
  "photo"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"|
  srcset="([^"]+)"|
  data-photos='(\[[^\]]+\])'
)/gix

// Uso con parseo de srcset
function extractInmowebPhotos(html) {
  const urls = new Set()
  
  // Intenta JSON ld+json primero
  const ldJson = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  if (ldJson) {
    try {
      const schema = JSON.parse(ldJson[1])
      if (schema.image) {
        Array.isArray(schema.image) 
          ? schema.image.forEach(u => urls.add(u))
          : urls.add(schema.image)
      }
    } catch (e) {}
  }
  
  // Luego srcset
  for (const match of html.matchAll(/srcset="([^"]+)"/g)) {
    const parts = match[1].split(',')
    for (const part of parts) {
      const url = part.trim().split(/\s+/)[0]
      if (url) urls.add(url)
    }
  }
  
  // Filtrar por CDN/dominio de Inmoweb
  return [...urls].filter(u => /inmoweb|cdn\.|photos|images/i.test(u))
}
```

---

## 3. LEVEL

**Dominios típicos:** levelrealestate.es, agenciagotico.es  
**URL de anuncio:** `https://www.agencia.es/property/8910/`  
**Tipo de almacenamiento:** CDN o almacenamiento local + lazy-loading

### 3.1 Estructura HTML de Fotos

#### Opción A: Objeto JavaScript global

```html
<script>
  window.propertyData = {
    "id": 8910,
    "gallery": {
      "images": [
        { "thumb": "https://level.es/media/property-8910-thumb.jpg",
          "full": "https://level.es/media/property-8910-full.jpg",
          "title": "Living room" },
        { "thumb": "https://level.es/media/property-8911-thumb.jpg",
          "full": "https://level.es/media/property-8911-full.jpg" }
      ]
    }
  };
</script>
```

**Selectores:**
- `window.propertyData.gallery.images[]` → array de fotos
- Cada objeto: `{ thumb, full, title }`
- Regex: `/window\.propertyData\s*=\s*(\{[\s\S]*?\});/`

#### Opción B: Elementos HTML con data-attributes

```html
<div class="gallery-container" id="gallery">
  <div class="gallery-item" data-image="https://level.es/media/property-8910-full.jpg"
                            data-thumb="https://level.es/media/property-8910-thumb.jpg"
                            data-title="Living room">
    <img src="https://level.es/media/property-8910-thumb.jpg" alt="Living room" />
  </div>
  <div class="gallery-item" data-image="https://level.es/media/property-8911-full.jpg"
                            data-thumb="https://level.es/media/property-8911-thumb.jpg">
    <img src="https://level.es/media/property-8911-thumb.jpg" />
  </div>
</div>
```

**Selectores CSS:**
- `.gallery-item[data-image]` → selecciona todos los items
- Atributo `data-image` → URL en resolución completa
- Atributo `data-thumb` → URL miniatura
- Regex: `/data-image="([^"]+)"/g` → extraer URLs completas

#### Opción C: Galería con slider (común en Level)

```html
<div class="gallery-slider" data-gallery-id="8910">
  <div class="slide">
    <img loading="lazy" 
         data-src="https://level.es/media/8910/img-1.jpg"
         src="https://level.es/media/8910/img-1-placeholder.jpg"
         alt="Photo 1" />
  </div>
  <div class="slide">
    <img loading="lazy"
         data-src="https://level.es/media/8910/img-2.jpg"
         src="https://level.es/media/8910/img-2-placeholder.jpg"
         alt="Photo 2" />
  </div>
</div>
```

**Selectores CSS:**
- `.gallery-slider` → contenedor principal
- `.slide` → cada slide
- `img[data-src]` → imagen con lazy-loading
- Regex: `/data-src="([^"]+)"/g`

### 3.2 Formato de URL

```
Patrones típicos Level:
  https://level.es/media/property-{id}-full.jpg
  https://level.es/media/property-{id}-thumb.jpg
  https://agenciagotico.es/fotos/inmueble-{id}/{filename}.jpg
  https://cdn.level.es/images/property-{id}/{n}.jpg
  
Variantes con sufijos:
  -full       → resolución completa
  -thumb      → miniatura
  -preview    → preview mediano
  -original   → imagen sin procesar
  
Lazy-loading:
  src:        placeholder de baja resolución
  data-src:   URL real (cargada al hacer scroll)
```

### 3.3 Galería y Múltiples Fotos

**Estructura típica:**
- Array en `propertyData.gallery.images[]` o similar
- Cada imagen tiene versiones: `thumb` y `full`
- Máximo: 30-40 fotos
- Lazy-loading común en sliders modernos

**Extracción:**
```javascript
// Opción 1: Desde objeto global
const match = html.match(/window\.propertyData\s*=\s*(\{[\s\S]*?\});/)
if (match) {
  const data = JSON.parse(match[1])
  const urls = data.gallery.images.map(img => img.full)
}

// Opción 2: Desde data-attributes
const items = [...html.matchAll(/data-image="([^"]+)"/g)]
const urls = items.map(m => m[1])

// Opción 3: Desde data-src (lazy-loaded)
const lazyImages = [...html.matchAll(/data-src="([^"]+)"/g)]
const urls = lazyImages.map(m => m[1])
```

### 3.4 Marca de Agua y Transformaciones

**Level generalmente no agrega marca de agua agresiva.**

**Transformación típica:**
```regex
Si existe tanto -thumb como -full:
  Preferir -full.jpg sobre -thumb.jpg
  Descartar URLs con -placeholder

Ejemplo:
  URLs: [
    https://level.es/media/property-8910-thumb.jpg,
    https://level.es/media/property-8910-full.jpg
  ]
  Resultado: https://level.es/media/property-8910-full.jpg
```

### 3.5 Selectores CSS Exactos

```css
.gallery-container
.gallery-slider
.gallery-item[data-image]
.slide img[data-src]
#gallery img
.photo-gallery img
.carousel-item img
```

### 3.6 Patrón Regex Compilado Recomendado

```javascript
// Extrae URLs de Level (múltiples formatos)
const LEVEL_PHOTO_REGEX = /(?:
  "full"\s*:\s*"([^"]+)"|
  data-image="([^"]+)"|
  data-src="([^"]+)"|
  src="([^"]*level[^"]*)"|
  srcset="([^"]+)"
)/gix

function extractLevelPhotos(html) {
  const urls = new Set()
  
  // Desde objeto JS
  const jsMatch = html.match(/window\.propertyData\s*=\s*(\{[\s\S]*?\});/)
  if (jsMatch) {
    try {
      const data = JSON.parse(jsMatch[1])
      if (data.gallery?.images) {
        data.gallery.images.forEach(img => {
          if (img.full) urls.add(img.full)
          else if (img.thumb) urls.add(img.thumb)
        })
      }
    } catch (e) {}
  }
  
  // Desde data-attributes
  for (const match of html.matchAll(/data-image="([^"]+)"/g)) {
    urls.add(match[1])
  }
  
  // Desde lazy-loading
  for (const match of html.matchAll(/data-src="([^"]+)"/g)) {
    urls.add(match[1])
  }
  
  return [...urls].filter(u => /\.jpe?g|\.webp/i.test(u))
}
```

---

## 4. FOTOCASA

**Dominios típicos:** fotocasa.es, ixpimg.com (CDN)  
**URL de anuncio:** `https://www.fotocasa.es/es/inmueble/casa/[region]/[ciudad]/[listing-id]/`  
**Tipo de almacenamiento:** CDN ixpimg.com + imgix para transformaciones

### 4.1 Estructura HTML de Fotos

#### Opción A: JSON Schema.org (Recomendado)

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@type": "RealEstateAgent",
  "image": [
    "https://images.ixpimg.com/portfolio/12345/1/100x75/image1.jpg",
    "https://images.ixpimg.com/portfolio/12345/2/100x75/image2.jpg"
  ],
  "photo": {
    "@type": "ImageObject",
    "url": "https://images.ixpimg.com/portfolio/12345/1/1000x750/image1.jpg"
  }
}
</script>
```

**Selectores:**
- `script[type="application/ld+json"]` → parsear como JSON
- Array `image[]` → URLs todas las fotos
- `photo.url` → foto principal

#### Opción B: Estructura HTML moderna (picture + srcset)

```html
<div class="gallery" data-gallery-id="12345">
  <picture class="gallery-picture">
    <source media="(max-width: 480px)" 
            srcset="https://images.ixpimg.com/portfolio/12345/1/480x360/image1.jpg 1x,
                    https://images.ixpimg.com/portfolio/12345/1/960x720/image1.jpg 2x" />
    <source media="(min-width: 481px)"
            srcset="https://images.ixpimg.com/portfolio/12345/1/1000x750/image1.jpg,
                    https://images.ixpimg.com/portfolio/12345/1/2000x1500/image1.jpg 2x" />
    <img class="gallery-image"
         src="https://images.ixpimg.com/portfolio/12345/1/1000x750/image1.jpg"
         alt="Gallery image 1" />
  </picture>
</div>
```

**Selectores CSS:**
- `.gallery-picture` → elemento picture
- `source[srcset]` → atributo srcset con variantes
- `.gallery-image` → imagen principal
- Regex srcset: `/srcset="([^"]+)"/g`

#### Opción C: Galería con thumbnails + full (Antiguo pero aún usado)

```html
<div class="photo-gallery">
  <div class="gallery-slider">
    <img class="lazy-image"
         data-full="https://images.ixpimg.com/portfolio/12345/1/original/image1.jpg"
         src="https://images.ixpimg.com/portfolio/12345/1/100x75/image1.jpg"
         alt="Image 1" />
    <img class="lazy-image"
         data-full="https://images.ixpimg.com/portfolio/12345/2/original/image2.jpg"
         src="https://images.ixpimg.com/portfolio/12345/2/100x75/image2.jpg"
         alt="Image 2" />
  </div>
</div>
```

**Selectores:**
- `.lazy-image[data-full]` → URLs en resolución completa
- Atributo `data-full` → imagen sin transformaciones
- Regex: `/data-full="([^"]+)"/g`

### 4.2 Formato de URL

```
CDN: images.ixpimg.com (propiedad de Fotocasa)

Patrón general:
  https://images.ixpimg.com/portfolio/{property_id}/{photo_index}/{size}/{filename}.jpg

Tamaños comunes:
  100x75          → thumbnail muy pequeño
  200x150         → thumbnail pequeño
  480x360         → mobile pequeño
  600x450         → tablet
  800x600         → desktop mediano
  1000x750        → desktop grande
  1200x900        → XL
  1600x1200       → XXL
  original        → sin transformación imgix
  
Ejemplo real:
  https://images.ixpimg.com/portfolio/12345/1/1000x750/image1.jpg
  https://images.ixpimg.com/portfolio/12345/1/original/image1.jpg

Parámetros imgix:
  ?auto=format&fit=crop&w=1000&h=750
  (pero la URL con tamaño en la ruta es suficiente)
```

### 4.3 Galería y Múltiples Fotos

**Estructura típica:**
- Array de URLs en JSON schema: `image[]`
- Cada URL en múltiples resoluciones (srcset)
- Máximo: 50-60 fotos por anuncio
- Lazy-loading común

**Extracción:**
```javascript
// Opción 1: Desde JSON Schema
const ldJsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
if (ldJsonMatch) {
  const schema = JSON.parse(ldJsonMatch[1])
  let urls = []
  if (schema.image) {
    urls = Array.isArray(schema.image) ? schema.image : [schema.image]
  }
  // Las URLs de schema a menudo vienen con tamaño; actualizar a /original/ o resolucion deseada
  urls = urls.map(u => u.replace(/\/\d+x\d+\//, '/1000x750/'))
}

// Opción 2: Desde srcset
const urls = new Set()
for (const match of html.matchAll(/srcset="([^"]+)"/g)) {
  const urls_str = match[1]
  // "url1 1x, url2 2x" o "url1 480w, url2 800w"
  for (const part of urls_str.split(',')) {
    const url = part.trim().split(/\s+/)[0]
    if (url && /images\.ixpimg/.test(url)) {
      // Preferir 1000x750 (buena resolución sin ser gigante)
      const normalized = url.replace(/\/\d+x\d+\//, '/1000x750/')
      urls.add(normalized)
    }
  }
}

// Opción 3: Desde data-full
const fullImages = [...html.matchAll(/data-full="([^"]+)"/g)]
const urls = fullImages.map(m => m[1])
```

### 4.4 Marca de Agua y Transformaciones

**Fotocasa generalmente NO agrega marca de agua visible**, pero usa imgix para transformaciones.

**Transformaciones imgix a considerar:**
```
Parámetros comunes (si están en URL):
  ?auto=format       → optimización automática de formato
  &fit=crop          → crop automático
  &w=1000&h=750      → redimensionar
  &q=75              → calidad 75%

Estrategia de limpieza:
  1. Remover parámetros imgix innecesarios
  2. Preferir tamaño /1000x750/ (balance calidad/tamaño)
  3. Rechazar tamaños muy pequeños (< 300px)
  4. Aceptar /original/ si existe

Ejemplo de normalización:
  Input:  https://images.ixpimg.com/portfolio/12345/1/100x75/image1.jpg?auto=format&q=50
  Output: https://images.ixpimg.com/portfolio/12345/1/1000x750/image1.jpg
```

### 4.5 Selectores CSS Exactos

```css
.gallery-picture
.gallery-image
.lazy-image[data-full]
picture > source[srcset]
picture > img
.photo-gallery img
.gallery-slider img
[data-gallery-id] img
```

### 4.6 Patrón Regex Compilado Recomendado

```javascript
// Extrae URLs de Fotocasa (múltiples formatos)
const FOTOCASA_PHOTO_REGEX = /(?:
  "image"\s*:\s*(\[[^\]]*\])|
  srcset="([^"]+)"|
  data-full="([^"]+)"|
  src="([^"]*ixpimg[^"]*)"
)/gix

function extractFotocasaPhotos(html) {
  const urls = new Set()
  
  // Desde JSON Schema
  const ldJson = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  if (ldJson) {
    try {
      const schema = JSON.parse(ldJson[1])
      if (schema.image) {
        const images = Array.isArray(schema.image) ? schema.image : [schema.image]
        images.forEach(img => {
          if (typeof img === 'string') {
            urls.add(normalizeIxpimgUrl(img))
          } else if (img.url) {
            urls.add(normalizeIxpimgUrl(img.url))
          }
        })
      }
    } catch (e) {}
  }
  
  // Desde srcset
  for (const match of html.matchAll(/srcset="([^"]+)"/g)) {
    const parts = match[1].split(',')
    for (const part of parts) {
      const url = part.trim().split(/\s+/)[0]
      if (url && /ixpimg/.test(url)) {
        urls.add(normalizeIxpimgUrl(url))
      }
    }
  }
  
  // Desde data-full
  for (const match of html.matchAll(/data-full="([^"]+)"/g)) {
    urls.add(normalizeIxpimgUrl(match[1]))
  }
  
  return [...urls]
}

function normalizeIxpimgUrl(url) {
  // Remover parámetros query
  url = url.split('?')[0]
  // Remover fragmentos
  url = url.split('#')[0]
  // Preferir resolución 1000x750 si no es /original/
  if (!url.includes('/original/') && /\/\d+x\d+\//.test(url)) {
    url = url.replace(/\/\d+x\d+\//, '/1000x750/')
  }
  return url
}
```

---

## 5. PATRONES GENERALES Y MEJORES PRÁCTICAS

### 5.1 Estrategia de Selección de Formato

Para cada plataforma, priorizar en este orden:

1. **JSON embebido** (más robusto): `application/ld+json`, `window.dataObj`, objetos JS
2. **Atributos data-*** (confiable): `data-image`, `data-src`, `data-photo`
3. **Atributos HTML estándar** (fallback): `src`, `href`, `srcset`
4. **Regex como último recurso** (frágil): buscar URLs directamente en HTML

### 5.2 Deduplicación de URLs

Problema: La misma foto puede aparecer en múltiples formatos/tamaños.

```javascript
function deduplicatePhotos(urls) {
  const seen = new Map() // photo_id → best_url
  
  for (const url of urls) {
    // Extraer ID base (antes del tamaño)
    const baseMatch = url.match(/portfolio\/(\d+)\/(\d+)/) || 
                      url.match(/\/Images\/(\d+)/) ||
                      url.match(/property-(\d+)/)
    
    if (!baseMatch) {
      seen.set(url, url) // URL única
      continue
    }
    
    const photoId = baseMatch[0]
    const current = seen.get(photoId)
    
    if (!current) {
      seen.set(photoId, url)
    } else {
      // Preferir URL más grande/mejor calidad
      const currentQuality = getUrlQuality(current)
      const newQuality = getUrlQuality(url)
      if (newQuality > currentQuality) {
        seen.set(photoId, url)
      }
    }
  }
  
  return [...seen.values()]
}

function getUrlQuality(url) {
  // Heurística: tamaño en la URL
  let size = 0
  const sizeMatch = url.match(/\/(\d+)x(\d+)\//)
  if (sizeMatch) {
    size = parseInt(sizeMatch[1]) * parseInt(sizeMatch[2])
  }
  
  // Preferir /original/ o /full/
  if (url.includes('/original/') || url.includes('/full/')) {
    size += 999999 // Bonus
  }
  
  // Penalizar thumbnails
  if (url.includes('-thumb') || url.includes('thumbnail')) {
    size -= 999999
  }
  
  return size
}
```

### 5.3 Validación de URLs

```javascript
function isValidPhotoUrl(url) {
  // Debe ser HTTPS y tener extensión de imagen
  if (!url || !url.startsWith('http')) return false
  if (!/\.(?:jpe?g|png|webp)(?:$|\?|#)/i.test(url)) return false
  
  // Rechazar placeholders y de muy baja calidad
  if (url.includes('placeholder') || url.includes('default')) return false
  if (url.includes('1x1') || url.includes('10x10')) return false
  
  // Rechazar si es demasiado pequeño (< 200px)
  const sizeMatch = url.match(/\/(\d+)x(\d+)\//)
  if (sizeMatch) {
    const w = parseInt(sizeMatch[1])
    const h = parseInt(sizeMatch[2])
    if (w < 200 && h < 200) return false
  }
  
  return true
}
```

### 5.4 Integración con Watermark Removal

```javascript
import { cleanPhotoUrl } from './watermark-removal.mjs'

async function extractPhotos(html, crm, sourceHint) {
  let rawPhotos = []
  
  // 1. Extraer según CRM
  switch(crm) {
    case 'MOBILIA':
      rawPhotos = extractMobiliaPhotos(html)
      break
    case 'INMOWEB':
      rawPhotos = extractInmowebPhotos(html)
      break
    case 'LEVEL':
      rawPhotos = extractLevelPhotos(html)
      break
    case 'FOTOCASA':
      rawPhotos = extractFotocasaPhotos(html)
      break
  }
  
  // 2. Validar URLs
  rawPhotos = rawPhotos.filter(isValidPhotoUrl)
  
  // 3. Deduplicar
  rawPhotos = deduplicatePhotos(rawPhotos)
  
  // 4. Limpiar watermarks
  const cleanPhotos = rawPhotos.map(url => cleanPhotoUrl(url, sourceHint))
  
  return cleanPhotos
}
```

---

## 6. TESTING Y VALIDACIÓN

### 6.1 URLs de Prueba (Ejemplos Documentados)

```javascript
// Copilot: estas son URLs ficticias pero válidas en estructura

// MOBILIA
const mobiliaTests = [
  'https://media.mobiliagestion.es/Images/1338678/photo_1.jpg',
  'https://media.mobiliagestion.es/Images/1338678/photo_1-original.jpg',
]

// INMOWEB
const inmowebTests = [
  'https://cdn.inmoweb.es/photos/property-4567/photo-1-thumb.jpg',
  'https://cdn.inmoweb.es/photos/property-4567/photo-1.jpg',
]

// LEVEL
const levelTests = [
  'https://level.es/media/property-8910-thumb.jpg',
  'https://level.es/media/property-8910-full.jpg',
]

// FOTOCASA
const fotocasaTests = [
  'https://images.ixpimg.com/portfolio/12345/1/100x75/image1.jpg',
  'https://images.ixpimg.com/portfolio/12345/1/1000x750/image1.jpg',
  'https://images.ixpimg.com/portfolio/12345/1/original/image1.jpg',
]
```

### 6.2 Test Script

```bash
# Ejecutar pruebas de extracción
node scraper/test-extraction.mjs

# Ejecutar pruebas de watermark removal
node scraper/test-watermark-removal.mjs

# Hacer scraping de zona con logs detallados
DEBUG=* node scraper/scrape-zone.mjs --zone madrid --op rent --limit 5
```

---

## 7. PRÓXIMOS PASOS

- [ ] Implementar extractores específicos por CRM en `lib/parse.mjs`
- [ ] Crear parser para Fotocasa si no existe
- [ ] Crear parser para Habitaclia
- [ ] Agregar tests unitarios para cada patrón de URL
- [ ] Documentar CDNs por agencia en `agencies_crm_map`
- [ ] Monitoreo de cambios en estructura HTML por CRM (por agencia)

---

**Versión:** 2.0  
**Última actualización:** June 19, 2026  
**Mantenedor:** Claude Code

## Referencias

- `scraper/lib/crm-detector.mjs` - Detección de CRM
- `scraper/lib/watermark-removal.mjs` - Limpieza de marcas de agua
- `scraper/lib/parse.mjs` - Parsers de HTML
- `scraper/README-CRM-DETECTION.md` - Documentación CRM
- `scraper/README-WATERMARK-REMOVAL.md` - Documentación watermark
