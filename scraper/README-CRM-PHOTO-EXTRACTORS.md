# CRM Photo Extractors

Módulo especializado para extraer fotos desde fichas de propiedades en diferentes plataformas CRM.

## Overview

El módulo `lib/crm-photo-extractors.mjs` proporciona funciones especializadas para cada CRM:

- **Mobilia** (media.mobiliagestion.es)
- **Inmoweb** (multi-tenant, dominios variables)
- **Level Real Estate** (white-label de Mobilia)
- **Fotocasa** (static.fotocasa.es, ixpimg.com)

Cada función:
1. Recibe HTML de la página y URL base (para resolver rutas relativas)
2. Retorna array de URLs de fotos (absolutas)
3. Maneja watermarks/transformaciones específicas del CRM
4. Incluye fallbacks automáticos si la estructura HTML cambia
5. **No persiste en BD** — solo extrae y retorna URLs

## Instalación / Uso

```javascript
import {
  extractPhotosFromMobilia,
  extractPhotosFromInmoweb,
  extractPhotosFromLevel,
  extractPhotosFromFotocasa,
} from './lib/crm-photo-extractors.mjs'

// Ejemplo: Extraer fotos de una página Mobilia
const html = await fetchHtml('https://www.housingo.es/Mobilia/VerInmueble/1338678/Ficha.html')
const photos = extractPhotosFromMobilia(html, 'https://www.housingo.es/')

console.log(photos)
// Output:
// [
//   'https://media.mobiliagestion.es/Images/1338678/photo1-original.jpg',
//   'https://media.mobiliagestion.es/Images/1338678/photo2-original.jpg',
//   ...
// ]
```

## API Detallada

### `extractPhotosFromMobilia(html, baseUrl)`

Extrae fotos desde páginas de **Mobilia** (usado por Housingo, Remax y otras).

**Características:**
- Host: `media.mobiliagestion.es`
- Rutas: `/Images/{ref}/photo.jpg`
- **Watermark removal**: Transforma `.jpg` → `-original.jpg`
- Prioridad de atributos: `data-original` > `data-src` > `src`

**Ejemplo:**
```javascript
const html = `
  <div class="gallery">
    <img src="https://media.mobiliagestion.es/Images/123456/living.jpg"
         data-original="https://media.mobiliagestion.es/Images/123456/living-original.jpg">
  </div>
`

const photos = extractPhotosFromMobilia(html, 'https://www.agencia.es/')
// => ['https://media.mobiliagestion.es/Images/123456/living-original.jpg']
```

**HTML Patterns Soportados:**
```html
<!-- data-original (preferido) -->
<img data-original="..." src="...">

<!-- data-src (lazy loading) -->
<img data-src="..." src="...">

<!-- src directo -->
<img src="...">

<!-- Galería explícita -->
<div class="gallery">
  <img src="...">
</div>
```

---

### `extractPhotosFromInmoweb(html, baseUrl)`

Extrae fotos desde páginas de **Inmoweb** (multi-tenant).

**Características:**
- Multi-tenant: dominios y hosts variados por agencia
- Caminos detectados: `/images/`, `/fotos/`, `/photos/`, `/uploads/`, `/galeria/`, etc.
- **Thumbnail removal**: Remueve sufijos automáticamente (`-thumb`, `-small`, `-mini`, etc.)
- Soporta `<picture><source>`, lazy-loading, y lightbox

**Ejemplo:**
```javascript
const html = `
  <picture>
    <source srcset="https://remax.es/images/789/photo-thumb.jpg 1x,
                    https://remax.es/images/789/photo@2x.jpg 2x">
    <img src="https://remax.es/images/789/photo-thumb.jpg">
  </picture>
`

const photos = extractPhotosFromInmoweb(html, 'https://remax.es/')
// => [
//   'https://remax.es/images/789/photo.jpg',
//   'https://remax.es/images/789/photo.jpg'  // dedup
// ]
```

**HTML Patterns Soportados:**
```html
<!-- Picture con source (patrón principal) -->
<picture>
  <source srcset="https://...1x, https://...2x">
  <img src="...">
</picture>

<!-- Lazy loading -->
<img data-src="https://...">

<!-- Lightbox -->
<a href="https://...large.jpg" class="gallery">
  <img src="https://...thumb.jpg">
</a>

<!-- Inline styles -->
<div style="background-image: url(https://...)"></div>
```

**Thumbnail Patterns Removidos:**
- `/thumbs/`, `/thumbnail/`, `/thumbnails/`
- `-thumb`, `-small`, `-sm`, `-mini` (como sufijo antes de extensión)

---

### `extractPhotosFromLevel(html, baseUrl)`

Extrae fotos desde páginas de **Level Real Estate**.

**Características:**
- Level usa Mobilia como backend de CDN
- Delega a `extractPhotosFromMobilia()` internamente
- Filtra por referencia de propiedad automáticamente
- URL patrón: `.../property-ref-{ref}/...`

**Ejemplo:**
```javascript
const html = `
  <img src="https://media.mobiliagestion.es/Images/555555/bedroom.jpg">
  <!-- Otras imágenes -->
`

const photos = extractPhotosFromLevel(html, 'https://agencia.es/property-ref-555555/')
// => ['https://media.mobiliagestion.es/Images/555555/bedroom-original.jpg', ...]
```

**Nota:** Level es un white-label de Mobilia, así que toda la lógica de extracción y watermark removal viene de Mobilia.

---

### `extractPhotosFromFotocasa(html, baseUrl)`

Extrae fotos desde páginas de **Fotocasa**.

**Características:**
- Hosts: `static.fotocasa.es`, `image.fotocasa.es`, `cdn.fotocasa.es`, `ixpimg.com`
- Rutas: `/images/ads/{uuid}`, `/images/client/{uuid}`
- Soporta Next.js `__NEXT_DATA__`, JSON-LD, `<picture>`, lazy-loading
- **Quality normalization**: Agrupa variantes de tamaño (`?rule=web_412x257` → `?rule=original`)

**Ejemplo:**
```javascript
const html = `
  <script id="__NEXT_DATA__" type="application/json">
  {"props":{"pageProps":{"realEstate":{"multimedias":[
    {"url":"https://static.fotocasa.es/images/ads/12345/room1.jpg"}
  ]}}}}
  </script>
  
  <picture>
    <source srcset="https://static.fotocasa.es/images/ads/12345/room2.jpg">
    <img src="...">
  </picture>
`

const photos = extractPhotosFromFotocasa(html, 'https://agencia.es/')
// => [
//   'https://static.fotocasa.es/images/ads/12345/room1.jpg',
//   'https://static.fotocasa.es/images/ads/12345/room2.jpg?rule=original'
// ]
```

**HTML Patterns Soportados:**
```html
<!-- __NEXT_DATA__ (SPA Next.js) -->
<script id="__NEXT_DATA__" type="application/json">
  {"props":{"pageProps":{"realEstate":{"multimedias":[...]}}}}
</script>

<!-- Picture con source -->
<picture>
  <source srcset="https://...">
  <img src="...">
</picture>

<!-- JSON-LD Schema.org -->
<script type="application/ld+json">
  {"image":"https://..."}
</script>

<!-- Lazy loading -->
<img data-src="https://static.fotocasa.es/...">
```

---

## Características Comunes

### URL Resolution

Todas las funciones resuelven URLs relativas contra `baseUrl`:

```javascript
// URL absoluta → se devuelve tal cual
'https://example.com/photo.jpg' → 'https://example.com/photo.jpg'

// URL de protocolo relativo → se resuelve
'//cdn.example.com/photo.jpg' + baseUrl: 'https://agencia.es/' 
  → 'https://cdn.example.com/photo.jpg'

// Ruta relativa → se resuelve contra baseUrl
'/images/photo.jpg' + baseUrl: 'https://agencia.es/property/123/'
  → 'https://agencia.es/images/photo.jpg'
```

### Filtrado de No-Imágenes

Se excluyen automáticamente:
- Archivos SVG (iconografía)
- URLs con palabras clave: `logo`, `icon`, `favicon`, `banner`, `watermark`, `stamp`, etc.
- Rutas de mapas: `/maps/`, `google-maps`
- Esquemas no-HTTP: `data:`, `mailto:`, `blob:`

### Límite de Fotos

Cada extractor retorna como máximo **40 fotos** (primer parámetro).

Rationale: Fotos adicionales más allá de 40 son raramente relevantes; los listados típicos tienen 10-30 fotos.

---

## Testing

```bash
node scraper/test-crm-photo-extractors.mjs
```

Ejecuta 20+ tests cobriendo:
- Extracción básica por CRM
- Watermark/thumbnail removal
- Deduplicación
- Fallbacks HTML
- Edge cases (HTML vacío, nulo, etc.)

---

## Integración con Parsers Existentes

Estas funciones están diseñadas para ser usadas junto con `parseDetailPage()` de `lib/parse.mjs`:

```javascript
// Flujo típico:
1. fetchHtml(url) → descarga HTML de la agencia
2. detectCRMFromUrl(url) → determina qué CRM es
3. extractPhotosFromX(html, baseUrl) → extrae fotos del HTML
4. cleanPhotos(photos, sourceHint) → aplica limpieza de watermarks
5. Opcional: calculatePhashFromUrl() → calcula fingerprints para dedup

// Ejemplo completo:
const { crm, agencyUrl } = detectCRMFromUrl(additionalLink)
const html = await fetchHtml(agencyUrl)

const photos = 
  crm === 'MOBILIA' ? extractPhotosFromMobilia(html, agencyUrl) :
  crm === 'INMOWEB' ? extractPhotosFromInmoweb(html, agencyUrl) :
  crm === 'LEVEL' ? extractPhotosFromLevel(html, agencyUrl) :
  crm === 'FOTOCASA' ? extractPhotosFromFotocasa(html, agencyUrl) :
  []

const cleaned = cleanPhotos(photos, crm.toLowerCase())
// => fotos limpias, sin watermarks, deduplicadas
```

---

## Limitaciones Conocidas

1. **Dependencia HTML**: Si una plataforma cambia su estructura HTML significativamente, los selectores pueden fallar. Las funciones incluyen fallbacks, pero pueden no capturar todas las fotos.

2. **JavaScript Rendering**: Las funciones trabajan solo con HTML estático (SSR). Si una página carga fotos vía JavaScript/AJAX, no las capturaré. Para Fotocasa que es SPA con Next.js, se soporta `__NEXT_DATA__` embebido.

3. **URLs Relativas Profundas**: Si una URL relativa usa `../`, se intenta resolver pero puede fallar en casos complejos.

4. **Rate Limiting**: No hay throttling incorporado. Si se scrappean muchas páginas, aplicar delays externos.

---

## Próximos Pasos

- [ ] Persistir fotos extraídas en tabla `listing_photos` (con timestamps, source CRM)
- [ ] Integrar con watermark removal más agresivo (si las transformaciones actuales son insuficientes)
- [ ] Soportar descarga/rehosting de fotos a Supabase
- [ ] Cálculo de phash para matching de duplicados
- [ ] Panel admin para inspeccionar fotos extraídas por CRM
- [ ] Metrics: % de cobertura por CRM, fotos/listing, etc.

---

**Implementado:** Jun 2026  
**Módulo:** `scraper/lib/crm-photo-extractors.mjs`  
**Tests:** `scraper/test-crm-photo-extractors.mjs`
