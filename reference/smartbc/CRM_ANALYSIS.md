# SmartBC CRM - Análisis Integral & Recomendaciones

## Resumen Ejecutivo

Después de analizar el sistema de **Particulares** (listings de Idealista/Fotocasa), he identificado **3 problemas críticos** y **múltiples mejoras** que pueden hacer el CRM más potente. El sistema funciona, pero le falta precisión y completitud de datos.

---

## 1. RETIRADOS (0) - POR QUÉ MUESTRA CERO

### Problema
El contador "Retirados (0)" está correcto pero **vacío por diseño**. Sucede porque:

1. **La base de datos NO guarda los particulares archivados** en el `getParticularesPage()` inicial
   - Línea 46 en `lib/db/queries/particulares.ts`: `.order("is_active", { ascending: false })`
   - Línea 47: `.order("created_at", { ascending: false })`
   - Solo ordena por `is_active`, pero **no filtra**

2. **La lógica de filtro en el cliente es correcta** (línea 1075-1076 de particulares-client.tsx):
   ```typescript
   if (!showRetired && !r.is_active) return false;  // Hide retired unless we're showing them
   if (showRetired && r.is_active) return false;     // Hide active when showing retired
   ```

3. **El problema real: Sin datos en la primera página = sin nada que filtrar**
   - Si cargamos 100 items activos, el array `allRows` solo tiene 100
   - `retiredCount = allRows.length - activeCount = 100 - 100 = 0`
   - Los retirados existen en BD pero **no en memoria del cliente**

### Solución Recomendada
Necesitamos una consulta separada o parámetro para cargar también los retirados en la página inicial:

```typescript
// Opción A: Una consulta trae activos + retirados
// Opción B: Dos consultas paralelas (activos vs retirados)
// Opción C: Agregar un parámetro `includeRetired` a getParticularesPage()
```

**Impacto**: Mostrar correctamente el contador "Retirados (X)" y poder cambiar entre tabs sin cargar más datos.

---

## 2. UBICACIÓN IMPRECISA - SOLO ZONA, NO DIRECCIÓN

### Problema Actual
- **BD**: Particulares tiene `zone TEXT` pero **NO tiene columna `address`**
- **Extractor**: `lib/sync/import-by-link/extractors/idealista.ts` extrae `listing.address` (línea 139) pero...
- **Destino**: Se guarda en `rawAttributes["Planta"]` (línea 169) pero **NO en la BD**
- **UI**: Muestra "Retiro" (zona) pero no "Calle Serrano 123, 3º A" (dirección exacta)

### Datos Disponibles en Idealista
```json
{
  "address": "Calle Serrano, 123",           // ← DISPONIBLE en JSON
  "municipality": "Madrid",                   // ← Está
  "district": "Retiro",                       // ← Está
  "province": "Madrid",                       // ← Está
}
```

El scraper obtiene esto pero **la BD no lo almacena**.

### Solución Recomendada
1. **Crear migración** para agregar columna `address` a `particulares`
   ```sql
   ALTER TABLE particulares ADD COLUMN IF NOT EXISTS address TEXT;
   CREATE INDEX idx_particulares_address ON particulares(address);
   ```

2. **Actualizar el extractor** para guardar la dirección en `address` (no solo en rawAttributes)

3. **Actualizar el UI** para mostrar dirección exacta:
   - En el modal: "Calle Serrano, 123" en lugar de solo "Retiro"
   - En el mapa: usar la dirección para geocodificar si no hay coordenadas

**Impacto**: Ubicación 10x más útil para contactar particulares y para localización exacta.

---

## 3. EXTRACCIÓN DE TELÉFONO - YA INTEGRADA, FALTA LA CONFIANZA

### Estado Actual ✅ (corrección tras revisión a fondo)
- **Función existe**: `detectAdvertiserFromHtml()` en `lib/sync/particulares/idealista-advertiser-detector.ts`
- **SÍ se llama**: `extractIdealista()` la ejecuta al final del extractor y el cron
  (`app/api/cron/particulares/scrape/route.ts`) persiste `advertiserInfo.phone` en BD
- **Captura teléfono con confianza**: HIGH, MEDIUM (LOW se descarta)
- **Marca como chat-only**: Campo `chat_only` boolean cuando no hay teléfono válido

### Lo Que Falta Realmente
1. **El nivel de confianza no se persiste**
   - El detector devuelve `phone_confidence` pero el cron lo descarta
   - Sin él, el asesor no sabe si un teléfono es fiable o dudoso

2. **Falta la columna `phone_confidence`** (migración 0035, creada en esta rama)

3. **La UI no distingue** teléfonos verificados de detectados/manuales

### Bug Adicional Descubierto: ZONA IMPRECISA
En `listingToPreview()` la precedencia de zona era:
```typescript
zone = municipality ?? district ?? province  // → "Madrid" (inútil)
```
cuando debería priorizar el dato más específico:
```typescript
zone = district ?? municipality ?? province  // → "Retiro" ✓
```
Por eso muchos anuncios mostraban "Madrid" en vez del distrito real.

**Impacto**: Contactar particulares directamente sabiendo qué teléfonos son fiables.

---

## PROBLEMAS ADICIONALES ENCONTRADOS

### A. Particulares sin Coordinates (Latitud/Longitud)
- **Problema**: Si Idealista no proporciona coords, el mapa no funciona
- **Solución**: Geocodificar usando la `address` con Google Maps API o similar

### B. Retired Listings No Tienen Metadata Asociada
- Cuando `is_active = false`, se pierde:
  - Qué hizo que se retirara (bajo de oferta, bajado por portal, etc.)
  - Cómo llegó a retirado (se detectó vs marcado manual)
- **Solución**: Agregar campo `retired_reason` enum

### C. Cambios de Precio No Se Trackean
- `particulares_changes` existe pero **no se popula** al cambiar precios
- **Solución**: Agregar lógica en el scraper para detectar cambios

### D. No Hay Historial de Contactos en la Tabla Base
- Tenemos `particulares_contacts` pero no se integra bien con la UI
- El "Último contacto" se calcula server-side (bien) pero falta:
  - Contar contactos por tipo (call, whatsapp, visit)
  - Timeline visual en la UI

### E. Particulares "Particulares" vs "Profesionales"
- Se detectan (`advertiser_type`) pero **no se usan** en filtros
- Clientes podrían querer filtrar solo "Particulares" (usuarios normales, sin agencias)
- **Falta**: Exposer este filtro en la UI

---

## FLUJO ACTUAL vs IDEAL

### Hoy (Actual)
```
Idealista HTML
    ↓
extractFromDom() / findEmbeddedListing()
    ↓
listingToPreview()
    ↓ (falta teléfono y dirección exacta)
INSERT particulares { zone, price, features, ... }
    ↓
UI muestra: "Retiro | €900/mes | 2 hab | Chat disponible"
```

### Ideal (Propuesto)
```
Idealista HTML
    ↓
extractFromDom() / findEmbeddedListing()
    ↓
listingToPreview()
    ↓
detectAdvertiserFromHtml()  ← Agregado
    ↓ (teléfono + confianza + dirección completa)
INSERT particulares { 
  zone, address, price, features, 
  phone, phone_confidence, 
  advertiser_type, owner_name, ...
}
    ↓
UI muestra: "Retiro, Calle Serrano 123 | €900/mes | 2 hab | 📞 +34 600 123 456 (high)"
    ↓
Advisor puede:
  - Llamar directo (HIGH confidence) 
  - Chatear por portal (NULL confidence)
  - Ver histórico de 5 contactos previos
  - Filtrar solo Particulares (no agencias)
  - Marcar como Retirado cuando baje del portal
```

---

## PLAN DE IMPLEMENTACIÓN (Prioridad)

### 🔴 CRÍTICO (Afecta cosas rotas)
1. **Mostrar contador "Retirados" correcto** 
   - 2-3 horas
   - Carga inicial mixta de activos+retirados

2. **Agregar columna `address` y rellenarla**
   - 1-2 horas (migración + actualizar extractor)
   - Impacto inmediato en precisión de ubicación

### 🟠 IMPORTANTE (Mejora UX significativa)
3. **Integrar phone extraction en el scraper**
   - 1 hora (ya existe, solo agregar llamada)
   - Almacenar `phone_confidence` en BD

4. **Mostrar dirección en UI + mapa mejorado**
   - 1-2 horas
   - Geocodificar si falta latitud/longitud

5. **Agregar filtro "Particular vs Profesional"**
   - 30 minutos
   - Los datos ya están, falta exponerlos

### 🟡 MEJORAS (Optimización)
6. **Trackear cambios de precio automáticamente**
   - 2 horas
   - Rellenar `particulares_changes` tabla

7. **Timeline visual de contactos por tipo**
   - 2-3 horas
   - UI en modal de particular

8. **Geocodificación automática de `address` → latitud/longitud**
   - 2-3 horas
   - Fallback si Idealista no proporciona coords

---

## CONCLUSIÓN

El CRM **funciona bien** para lo básico, pero le **falta datos exactos** que Idealista ya proporciona:
- Dirección exacta (calle y número)
- Teléfono del particular  
- Tipo de anunciante (particular vs agencia)

Con estas 3 mejoras críticas + 5 complementarias, los asesores tendrían:
- ✅ Ubicación precisa (no solo zona)
- ✅ Contacto directo (teléfono de alta confianza)
- ✅ Contexto completo (tipo de vendedor, historial de contactos)
- ✅ Mejor tracking (cambios de precio, retiradas)

**Recomendación**: Implementar CRÍTICOS primero (4-5 horas), luego IMPORTANTES (3-4 horas).
