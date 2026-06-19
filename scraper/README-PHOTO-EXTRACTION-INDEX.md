# Photo Extraction Documentation Index

Índice completo de la documentación técnica sobre extracción de fotos de plataformas CRM inmobiliarias.

---

## 📋 Documentos por Propósito

### Para Empezar Rápido (5 min read)
1. **[PHOTO-EXTRACTION-QUICK-REFERENCE.md](PHOTO-EXTRACTION-QUICK-REFERENCE.md)**
   - Tabla comparativa de las 4 plataformas
   - Selectores CSS y regexes listos para usar
   - Pasos de extracción simplificados
   - Patrones compilados por CRM
   - **Ideal para:** Copiar/pegar código de extracción

### Para Entender la Arquitectura (15 min read)
2. **[README-PLATFORM-PHOTO-EXTRACTION.md](README-PLATFORM-PHOTO-EXTRACTION.md)**
   - Documentación técnica completa (29 KB)
   - Estructura HTML detallada de cada plataforma
   - Métodos de extracción (4-5 opciones por CRM)
   - Patrones regex compilados
   - Deduplicación de URLs
   - Validación de URLs
   - Integración con watermark removal
   - **Ideal para:** Comprender el "por qué" de cada decisión

### Para Ver Ejemplos Reales (10 min read)
3. **[PLATFORM-HTML-EXAMPLES.md](PLATFORM-HTML-EXAMPLES.md)**
   - Ejemplos HTML obfuscados de cada plataforma
   - Estructuras JS objects, JSON-LD, Picture responsivo
   - Ejemplos de lazy-loading
   - Comparativa de cómo cada plataforma estrutura fotos
   - Code snippets para extracción de cada ejemplo
   - **Ideal para:** Visualizar cómo se ve el HTML real

### Para Integrar en Código (20 min read)
4. **[PHOTO-EXTRACTION-INTEGRATION.md](PHOTO-EXTRACTION-INTEGRATION.md)**
   - Cómo integrar extractores en el flujo actual
   - Cambios en `parse.mjs`
   - Consideraciones de performance
   - Caching con Redis
   - Testing end-to-end
   - Casos edge y solución de problemas
   - Roadmap priorizado
   - **Ideal para:** Implementar la funcionalidad

### Para Referenciar Rápido (Bookmarks)
5. **ESTE DOCUMENTO** — Índice de navegación
6. **[README-CRM-DETECTION.md](README-CRM-DETECTION.md)** — Cómo funciona detección de CRM
7. **[README-WATERMARK-REMOVAL.md](README-WATERMARK-REMOVAL.md)** — Cómo se limpian watermarks

---

## 🔧 Módulos de Código Relacionados

### Módulos Principales
- **[lib/crm-detector.mjs](lib/crm-detector.mjs)**
  - Detecta CRM desde URL del "enlace adicional"
  - Extrae referencia del anuncio en CRM
  - Funciones: `detectCRMFromUrl()`, `detectCRMFromDetailPage()`

- **[lib/crm-photo-extractors.mjs](lib/crm-photo-extractors.mjs)**
  - **19 KB** de código de extracción por CRM
  - Funciones: `extractPhotosFromMobilia()`, `extractPhotosFromInmoweb()`, etc.
  - Fallbacks, deduplicación, validación incorporada

- **[lib/watermark-removal.mjs](lib/watermark-removal.mjs)**
  - Limpia marcas de agua específicas por CRM
  - Transforma URLs (ej: `.jpg` → `-original.jpg` en Mobilia)
  - Funciones: `cleanPhotoUrl()`, `cleanPhotos()`

- **[lib/parse.mjs](lib/parse.mjs)**
  - Parser principal de HTML de Idealista
  - Orquesta detección CRM + extracción fotos + limpieza
  - Función: `parseDetailPage()`

---

## 🎯 Flujo de Datos Completo

```
1. HTML de Idealista ficha detalle
   ↓
2. detectCRMFromDetailPage() [crm-detector.mjs]
   ├─ Extrae "enlace adicional"
   ├─ Detecta CRM (Mobilia, Inmoweb, Level, etc.)
   └─ Extrae referencia del anuncio
   ↓
3. SI agency_url existe:
   ├─ Fetch HTML del CRM
   ├─ extractPhotosByCRM(html, crm) [crm-photo-extractors.mjs]
   └─ Retorna URLs de fotos del CRM
   SINO:
   └─ Usar fotos de Idealista
   ↓
4. cleanPhotos(urls, sourceHint) [watermark-removal.mjs]
   ├─ Detecta plataforma de origen
   ├─ Aplica transformaciones específicas
   └─ Deduplica URLs
   ↓
5. Objeto listing con fotos limpias
```

---

## 📊 Tabla Comparativa de Plataformas

| Aspecto | Mobilia | Inmoweb | Level | Fotocasa |
|---------|---------|---------|-------|----------|
| **CDN** | media.mobiliagestion.es | Varios | media.mobiliagestion.es | ixpimg.com |
| **Estructura Principal** | JS object `adInformation` | JSON-LD + srcset | data-image | JSON-LD + srcset |
| **Marca de Agua** | `.jpg` → `-original.jpg` | No | Igual Mobilia | No |
| **Lazy Loading** | Ocasional | Común | Ocasional | Común |
| **Fotos Típicas** | 20-30 | 15-25 | 15-25 | 30-50 |
| **Extracción Difícil** | ⭐ Fácil | ⭐⭐ Medio | ⭐ Fácil | ⭐⭐ Medio |

---

## 🚀 Guía de Inicio Rápido

### 1. Extraer fotos de una URL Mobilia
```javascript
import { extractPhotosFromMobilia } from './lib/crm-photo-extractors.mjs'

const html = await fetch('https://www.housingo.es/Mobilia/VerInmueble/1338678/')
  .then(r => r.text())
const photos = extractPhotosFromMobilia(html, 'https://www.housingo.es/')
// → ['https://media.mobiliagestion.es/Images/1338678/photo-original.jpg', ...]
```

### 2. Detectar CRM desde Idealista y extraer fotos
```javascript
import { detectCRMFromDetailPage } from './lib/crm-detector.mjs'
import { extractPhotosByCRM } from './lib/crm-photo-extractors.mjs'
import { cleanPhotos } from './lib/watermark-removal.mjs'

const idealista_html = await fetch('https://www.idealista.com/inmueble/12345/')
  .then(r => r.text())

const crmData = detectCRMFromDetailPage(idealista_html)
if (crmData?.agencyUrl) {
  const agency_html = await fetch(crmData.agencyUrl).then(r => r.text())
  const photos = extractPhotosByCRM(agency_html, crmData.crm)
  const cleaned = cleanPhotos(photos, crmData.crm.toLowerCase())
  console.log(cleaned)
}
```

### 3. Usar en parse.mjs
```javascript
// Ya integrado en el futuro; ver PHOTO-EXTRACTION-INTEGRATION.md
```

---

## 🧪 Testing

### Test de Detectores
```bash
node test-extraction.mjs --crm MOBILIA
node test-extraction.mjs --crm INMOWEB
node test-extraction.mjs --crm LEVEL
node test-extraction.mjs --crm FOTOCASA
```

### Test de Watermark Removal
```bash
node test-watermark-removal.mjs
```

### Test End-to-End
```bash
node scraper/scrape-zone.mjs --zone madrid --op rent --limit 5 --dry-run
```

---

## 📍 Selectores CSS Principales

### MOBILIA
```css
[data-original]
[data-src]
.gallery-photo
picture > source[srcset]
```

### INMOWEB
```css
picture > source[srcset]
[data-src]
[data-photos]
.property-gallery
```

### LEVEL
```css
[data-image]
[data-src]
picture > source[srcset]
.gallery-item
```

### FOTOCASA
```css
picture > source[srcset]
[data-full]
script[type="application/ld+json"]
img[data-src*="ixpimg"]
```

---

## 🔍 Patrones Regex Compilados

### MOBILIA
```javascript
/(?:data-original|data-src|src)="([^"]*media\.mobiliagestion\.es\/Images[^"]*)"/g
```

### INMOWEB
```javascript
/srcset="([^"]+)"/g
/data-src="([^"]+(?:photos|images|fotos)[^"]*)"/gi
```

### LEVEL
```javascript
/data-image="([^"]+)"/g
/propertyData\s*=\s*(\{[\s\S]*?\});/
```

### FOTOCASA
```javascript
/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i
/srcset="([^"]+)"/g
/https?:\/\/[^\/]*ixpimg\.com[^\s"'<>]+\.(?:jpe?g|png|webp)/gi
```

---

## 📈 Estadísticas Esperadas

Una vez integrado, esperamos:
- **78% de fotos desde Idealista** (sin agency URL)
- **11% desde Mobilia** (agencias en Housingo, Level, etc.)
- **5.5% desde Inmoweb** (agencias multi-tenant)
- **2.8% desde Fotocasa** (agencias directas en Fotocasa)
- **1.8% desde Level** (agencias en platform Level)

Promedio: **6-7 fotos por anuncio** (vs. 4-5 en portales solos).

---

## ⚠️ Gotchas Comunes

1. **Lazy-loading:** Buscar `data-src`, no solo `src`
2. **Srcset:** Parsear correctamente "url1 600w, url2 800w"
3. **URLs relativas:** Usar `resolveUrl()` para convertir a absolutas
4. **Watermarks:** Aplicar transformaciones **después** de extraer
5. **Deduplicación:** El mismo ID de foto en múltiples tamaños = 1 foto
6. **Timeout:** Agency URLs pueden estar caídas (fallback a Idealista)
7. **CDN cambios:** Monitorear si un CRM cambia su dominio CDN

---

## 🗂️ Estructura de Archivos

```
scraper/
├── lib/
│   ├── crm-detector.mjs                    (Detectar CRM)
│   ├── crm-photo-extractors.mjs            (Extraer fotos)
│   ├── watermark-removal.mjs               (Limpiar watermarks)
│   ├── parse.mjs                           (Parser principal)
│   └── ... otros módulos
│
├── README-PLATFORM-PHOTO-EXTRACTION.md     (Documentación técnica 📘)
├── PHOTO-EXTRACTION-QUICK-REFERENCE.md     (Referencia rápida 📝)
├── PLATFORM-HTML-EXAMPLES.md               (Ejemplos HTML 💻)
├── PHOTO-EXTRACTION-INTEGRATION.md         (Cómo integrar 🔧)
├── README-PHOTO-EXTRACTION-INDEX.md        (Este archivo 📋)
│
├── README-CRM-DETECTION.md                 (Detección CRM)
├── README-WATERMARK-REMOVAL.md             (Watermark removal)
├── README-CRM-PHOTO-EXTRACTORS.md          (API referencia)
└── ... otros READMEs
```

---

## 🎓 Learning Path Recomendado

### Para Desarrolladores
1. Lee: PHOTO-EXTRACTION-QUICK-REFERENCE.md (5 min)
2. Lee: PLATFORM-HTML-EXAMPLES.md (10 min)
3. Lee: PHOTO-EXTRACTION-INTEGRATION.md (20 min)
4. Code: Modifica `parse.mjs` con extractores
5. Test: Ejecuta tests unitarios y end-to-end

### Para DevOps / Infraestructura
1. Lee: README-PLATFORM-PHOTO-EXTRACTION.md sección "Testing"
2. Setup: Redis para caché (opcional pero recomendado)
3. Monitor: Alertas si un CRM cambia estructura HTML
4. Analyze: Dashboard de photo_source distribution

### Para Product / Negocio
1. Lee: Sección "Estadísticas Esperadas" (este documento)
2. Analiza: Impact en cobertura y calidad de fotos
3. Mide: photo_count distribution por CRM
4. Optimiza: Priorizar fotos de CRMs con mejor calidad

---

## 🤝 Contribuir

Para agregar un nuevo CRM:
1. Documentar estructura HTML en PLATFORM-HTML-EXAMPLES.md
2. Implementar `extractPhotosFromXXX()` en crm-photo-extractors.mjs
3. Agregar cleaner en watermark-removal.mjs si necesario
4. Agregar patrón a README-PLATFORM-PHOTO-EXTRACTION.md
5. Tests unitarios
6. Documentar en este índice

---

## 📞 Soporte

### ¿Fotos no se extraen?
→ Revisa PHOTO-EXTRACTION-INTEGRATION.md § "Solución de Problemas"

### ¿Estructura HTML cambió?
→ Crea issue con ejemplo HTML nuevo

### ¿Necesitas nuevo CRM?
→ Abre PR con PLATFORM-HTML-EXAMPLES.md actualizado

---

## 📚 Referencias

- **CRM Detection:** [README-CRM-DETECTION.md](README-CRM-DETECTION.md)
- **Watermark Removal:** [README-WATERMARK-REMOVAL.md](README-WATERMARK-REMOVAL.md)
- **API Reference:** [README-CRM-PHOTO-EXTRACTORS.md](README-CRM-PHOTO-EXTRACTORS.md)
- **Plan del Proyecto:** [../../docs/PLAN-MAESTRO.md](../../docs/PLAN-MAESTRO.md)

---

**Versión:** 2.0  
**Última actualización:** June 19, 2026  
**Mantenedor:** Claude Code

---

## Changelog

### v2.0 (Jun 19, 2026)
- Agregado índice maestro este documento
- Completada documentación técnica (5 documentos)
- Ejemplos HTML reales de 4 plataformas
- Guía de integración en código existente
- Patrones regex compilados listos para usar

### v1.0 (Anterior)
- Documentación inicial de CRM detection
- README de watermark removal
