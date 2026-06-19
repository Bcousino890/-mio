# Selector de Fotos por Fuente

## Visión general

Implementación de un selector visual en la galería de fotos que permite elegir entre:
- **Todas**: todas las fotos del listing
- **Idealista**: fotos publicadas en Idealista
- **Agencia**: fotos publicadas por la agencia
- Etc. (cualquier fuente con fotos)

## Ubicación

- **Componente**: `/web/app/anuncios/[id]/page.tsx`
- **API**: `/web/app/api/listings/route.ts`
- **Modelos**: `/web/lib/mock-listings.ts`

## Cómo funciona hoy

### Estado actual (sin múltiples fuentes)

Hoy el código está preparado pero esperando datos de múltiples fuentes:

1. El componente retorna un `Source[]` de `listing.sources`
2. Cada `Source` puede tener un campo `photos?: string[]`
3. Si `photos` NO viene en el source, se usa `listing.photos` (todas)
4. El selector **solo se muestra si hay 2+ fuentes con fotos distintas**

```typescript
// En web/app/anuncios/[id]/page.tsx línea ~360
const hasMultiplePhotoSources = l.sources.some((s) => (s.photos?.length ?? 0) > 0)
const photoSources = hasMultiplePhotoSources
  ? l.sources.filter((s) => (s.photos?.length ?? 0) > 0)
  : l.sources

const activePhotos = selectedPhotoSource && selectedPhotoSource.photos?.length
  ? selectedPhotoSource.photos      // Fotos de la fuente seleccionada
  : allPhotos                        // O todas las fotos
```

## Roadmap para habilitar

### Paso 1: API — Retornar fotos por fuente

En `web/app/api/listings/route.ts`, modificar la query SQL para:

```sql
-- Opción A: Si la BD ya divide fotos por fuente
SELECT 
  ...
  (SELECT jsonb_object_agg(portal, photos) 
   FROM ... 
   GROUP BY portal) as photos_by_source
```

**O** agregar columna a `listings` con estructura como:
```json
{
  "idealista": ["url1", "url2"],
  "agencia": ["url3", "url4"],
  "vivanuncios": ["url5"]
}
```

### Paso 2: Componente — Mapear fotos a fuentes

En `web/app/anuncios/[id]/page.tsx`, cuando construyas `sources[]`:

```typescript
// Actualizar el mapeo de sources (línea ~260)
const transformed: Listing = {
  ...
  sources: [
    {
      id: `${found.id}-${portal}`,
      name: found.advertiser_name,
      portal,
      photos: found.photos_by_source?.[portal] || found.photos,
      // ... otros campos
    },
    // Si hay más fuentes, agregar aquí
  ]
}
```

### Paso 3: UI — El selector aparecerá automáticamente

Una vez que 2+ sources tengan `photos` distinto, el selector se mostrará:

```
[Todas (45)] [Idealista (30)] [Agencia (15)]
```

Cada fuente mostrará su contador de fotos.

## API Response (backward compatible)

El endpoint `/api/listings` ahora retorna:

```json
{
  "id": "12345",
  "photos": [...],
  "photos_by_source": {
    "idealista": [...],
    "agencia": [...]
  },
  "sources": [
    {
      "id": "12345-idealista",
      "portal": "idealista",
      "photos": [...],  // Opcional, se puebla desde API o BD
      "name": "Inmobiliario XYZ"
    }
  ]
}
```

## Estado del componente

```typescript
const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
```

- `null` o `'all'` → mostrar todas las fotos
- `'source-id-xyz'` → mostrar fotos de esa fuente
- Reset a `null` cuando cambia `mediaTab`

## Ejemplo de extensión

Si en el futuro tienes múltiples agencias para el mismo property:

```typescript
sources: [
  { id: "123-idealista", name: "Idealista", portal: "idealista", photos: [...] },
  { id: "123-agencia-a", name: "Agencia A", portal: "agencia", photos: [...] },
  { id: "123-agencia-b", name: "Agencia B", portal: "agencia", photos: [...] },
  { id: "123-vivocerca", name: "VivioCerca", portal: "vivocerca", photos: [...] },
]
```

El selector mostrará:
```
[Todas (100)] [Idealista (35)] [Agencia A (30)] [Agencia B (20)] [VivioCerca (15)]
```

## Notas

- El selector es **solo visual**, no modifica datos
- Al cambiar de fuente, `photoIdx` se resetea a `0`
- Compatible con tabs de "Fotos", "Planos", "Vídeo"
- El selector se oculta si hay `1` o `0` fuentes con fotos

## Testing

1. Agregar múltiples fuentes a un listing de prueba
2. Asignar fotos distintas a cada fuente
3. Verificar que el selector aparezca
4. Verificar que cambiar de fuente actualice la galería
5. Verificar que los contadores sean correctos
