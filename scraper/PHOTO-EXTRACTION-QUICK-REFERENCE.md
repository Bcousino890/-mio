# Photo Extraction Quick Reference

Resumen ejecutivo de selectores CSS, patrones regex y métodos de extracción para cada plataforma CRM.

## Tabla de Referencia Rápida

| Plataforma | CDN Principal | Selector/Atributo | Patrón URL Base | Marca de Agua | Transformación |
|-----------|---------------|------------------|-----------------|---------------|----------------|
| **Mobilia** | media.mobiliagestion.es | `[data-original]` o `var adInformation` | `/Images/{id}/` | `.jpg` | `→ -original.jpg` |
| **Inmoweb** | CDN variable | `<picture srcset>` o `[data-src]` | `/photos/`, `/images/` | No | Remover `-thumb`, `-sm` |
| **Level** | media.mobiliagestion.es | Mismo que Mobilia | `/Images/{id}/` | `.jpg` | `→ -original.jpg` |
| **Fotocasa** | ixpimg.com | `<source srcset>` o JSON-LD | `/portfolio/{id}/` | No | Normalizar tamaños |

---

## Selectores CSS/Atributos Exactos por Plataforma

### MOBILIA

```css
/* Selectores */
[data-original]              /* Imagen sin thumbnail */
[data-src]                   /* Lazy-loading */
.gallery-photo
.gallery-container img
picture > source[srcset]

/* Atributos a buscar */
data-original="..."          /* Prioridad 1: full resolution */
data-src="..."               /* Prioridad 2: lazy-loaded */
src="..."                    /* Prioridad 3: fallback */
```

**Regex compilado:**
```javascript
/(?:data-original|data-src|src)="([^"]*media\.mobiliagestion\.es\/Images[^"]*)"/g
```

**Transformación watermark:**
```javascript
url.replace(/\.jpe?g(?=$|[?#])/i, (m) => `-original${m.toLowerCase()}`)
// /Images/1338678/photo.jpg → /Images/1338678/photo-original.jpg
```

---

### INMOWEB

```css
/* Selectores */
picture > source[srcset]     /* Principal: responsivo */
picture > img
[data-src]
[data-photos]
.gallery-container
.property-gallery

/* Atributos a buscar */
srcset="..."                 /* Múltiples URLs: "url1 600w, url2 800w" */
data-src="..."
data-photos='[...]'          /* JSON array como atributo */
```

**Regex para srcset:**
```javascript
/srcset="([^"]+)"/g
// Parsear: "url1 600w, url2 800w" → extraer todas las URLs
urls = srcset.split(',').map(s => s.trim().split(/\s+/)[0])
```

**Transformación (remover thumbnails):**
```javascript
const patterns = [
  /\/thumbs\//i,
  /-thumb(?=\.[a-z]+)/i,
  /-small(?=\.[a-z]+)/i,
  /-sm(?=\.[a-z]+)/i
]
patterns.forEach(p => url = url.replace(p, ''))
```

---

### LEVEL

```css
/* Selectores */
[data-image]                 /* Full resolution */
[data-src]                   /* Lazy-loading */
picture > source[srcset]
.gallery-item
.gallery-container

/* Atributos a buscar */
data-image="..."             /* Prioridad: imagen completa */
data-src="..."               /* Lazy-load */
```

**Desde objeto JS:**
```javascript
// Buscar: window.propertyData = {...}
const jsMatch = html.match(/propertyData\s*=\s*(\{[\s\S]*?\});/)
// Luego extraer: "full": "url", "image": "url"
```

**Deduplicar:**
```javascript
// Preferir -full.jpg sobre -thumb.jpg
// Descartar placeholders
```

---

### FOTOCASA

```css
/* Selectores */
picture > source[srcset]     /* Principal: responsivo */
picture > img
[data-full]
script[type="application/ld+json"]

/* Atributos a buscar */
srcset="..."                 /* URLs con tamaños: 100x75, 1000x750 */
data-full="..."
```

**JSON-LD Schema (recomendado):**
```html
<script type="application/ld+json">
{
  "image": [
    "https://images.ixpimg.com/portfolio/12345/1/1000x750/image1.jpg",
    ...
  ]
}
</script>
```

**Normalización ixpimg:**
```javascript
// Remover parámetros y normalizar tamaño
url = url.split('?')[0]
url = url.replace(/\/\d+x\d+\//, '/1000x750/')  // tamaño estándar
```

---

## Extracción Paso a Paso

### Paso 1: Detectar CRM
```javascript
import { detectCRMFromDetailPage } from './lib/crm-detector.mjs'

const detection = detectCRMFromDetailPage(html)
// => { crm: 'MOBILIA', agencyDomain: 'housingo.es', referenceId: '1338678' }
```

### Paso 2: Extraer Fotos
```javascript
import { extractPhotosByCRM } from './lib/crm-photo-extractors.mjs'

const photos = extractPhotosByCRM(html, detection.crm)
// => ['https://media.mobiliagestion.es/Images/1338678/photo-original.jpg', ...]
```

### Paso 3: Limpiar Watermarks
```javascript
import { cleanPhotos } from './lib/watermark-removal.mjs'

const cleanPhotos = cleanPhotos(photos, 'idealista')
// => Aplica transformaciones específicas por plataforma
```

### Integración Completa
```javascript
async function extractPropertyPhotos(html, baseUrl) {
  // 1. Detectar CRM desde "enlace adicional" si está disponible
  const crmData = detectCRMFromDetailPage(html)
  
  if (!crmData) {
    // No tenemos CRM detectado, retornar array vacío
    return []
  }
  
  // 2. Extraer fotos específicas por CRM
  const rawPhotos = extractPhotosByCRM(html, crmData.crm)
  
  // 3. Aplicar limpieza de watermarks
  const cleanPhotos = cleanPhotos(rawPhotos, crmData.crm.toLowerCase())
  
  return cleanPhotos
}
```

---

## Patrones Regex Compilados Listos para Usar

### MOBILIA
```javascript
const MOBILIA_PHOTOS = /(?:data-original|data-src)="([^"]*media\.mobiliagestion\.es\/Images[^"]*)"/g
const matches = [...html.matchAll(MOBILIA_PHOTOS)]
const urls = matches.map(m => m[1])
```

### INMOWEB
```javascript
// Desde srcset
const INMOWEB_SRCSET = /srcset="([^"]+)"/g
const parseSrcset = (srcset) => srcset.split(',').map(s => s.trim().split(/\s+/)[0])

// Desde data-src
const INMOWEB_DATA_SRC = /data-src="([^"]+(?:photos|images|fotos)[^"]*)"/gi
```

### LEVEL
```javascript
const LEVEL_DATA_IMAGE = /data-image="([^"]+)"/g
const LEVEL_JS_OBJECT = /propertyData\s*=\s*(\{[\s\S]*?\});/
```

### FOTOCASA
```javascript
// Desde JSON-LD
const FOTOCASA_JSON_LD = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i

// Desde srcset
const FOTOCASA_SRCSET = /srcset="([^"]+)"/g

// Directo ixpimg
const FOTOCASA_IXPIMG = /https?:\/\/[^\/]*ixpimg\.com[^\s"'<>]+\.(?:jpe?g|png|webp)/gi
```

---

## Casos de Uso Comunes

### Extraer solo URL principal (primera foto)
```javascript
const photos = extractPhotosByCRM(html, crm)
const mainPhoto = photos[0]  // Primera foto
```

### Extraer con metadatos (orden, título)
```javascript
// Para Mobilia con objeto adInformation
const jsMatch = html.match(/var\s+adInformation\s*=\s*(\{[\s\S]*?\});/)
if (jsMatch) {
  const objText = jsMatch[1]
  // Aquí está "order", "main", "description"
  const ordered = objText.matchAll(/"order"\s*:\s*(\d+)[^}]*"url"\s*:\s*"([^"]+)"/g)
}
```

### Deduplicar por ID de foto
```javascript
const dedup = new Map()
for (const url of photos) {
  // Extraer ID base: /Images/1338678/photo.jpg → "1338678_photo"
  const match = url.match(/\/Images\/(\d+)\/([^\/]+?)(?:-original)?\.jpe?g/i)
  if (match) {
    const id = `${match[1]}_${match[2]}`
    dedup.set(id, url)  // Última versión gana
  }
}
const dedupUrls = [...dedup.values()]
```

---

## Testing

### Test Script Básico
```bash
# Dentro de scraper/

# Prueba rápida de extración
node -e "
import('lib/crm-photo-extractors.mjs').then(mod => {
  const html = '<img src=\"https://media.mobiliagestion.es/Images/123/test.jpg\" />'
  console.log(mod.extractPhotosFromMobilia(html, 'https://example.es/'))
})
"

# Test con archivo HTML real
node test-extraction.mjs --file real-listing.html --crm MOBILIA
```

### URL de Prueba por CRM
```javascript
// MOBILIA
'https://media.mobiliagestion.es/Images/1338678/photo-original.jpg'

// INMOWEB
'https://cdn.example.es/photos/property-4567/photo-1.jpg'

// LEVEL  
'https://level.es/media/property-8910-full.jpg'

// FOTOCASA
'https://images.ixpimg.com/portfolio/12345/1/1000x750/image1.jpg'
```

---

## Integración en parse.mjs

El módulo actual utiliza:
- `extractPhotosFromMobilia()` para "enlace adicional" a Mobilia
- `cleanPhotos()` para remover watermarks
- Fallback a regex si JSON embebido no está disponible

**Próxima mejora:** detectar CRM automáticamente y elegir extractor óptimo.

---

## Solución de Problemas

### No se extraen fotos
1. ¿El CRM es correctamente detectado? Verificar `detectCRMFromDetailPage()`
2. ¿El HTML contiene la estructura esperada? Revisar con DevTools
3. ¿Los selectores CSS coinciden? Testear regex por separado
4. ¿Hay lazy-loading? Buscar `data-src`, no solo `src`

### Fotos con watermark
1. Verificar que `cleanPhotos()` está siendo llamado
2. Revisar que el `sourceHint` es correcto ('mobilia', 'inmoweb', etc.)
3. Testear transformación: `/photo.jpg` → `/photo-original.jpg`

### URLs rotas
1. ¿Son URLs relativas? Verificar `resolveUrl()` en crm-photo-extractors.mjs
2. ¿Dominios CDN cambiaron? Actualizar patrones en este documento
3. ¿Parámetros query invalidan URL? Remover con `.split('?')[0]`

---

## Referencias Técnicas

- **Plataforma de Detección:** `lib/crm-detector.mjs`
- **Extractores:** `lib/crm-photo-extractors.mjs`
- **Limpieza:** `lib/watermark-removal.mjs`
- **Parser Principal:** `lib/parse.mjs`
- **Documentación Completa:** `README-PLATFORM-PHOTO-EXTRACTION.md`

---

**Última actualización:** June 19, 2026  
**Mantenedor:** Claude Code
