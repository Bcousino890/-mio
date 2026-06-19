# Arquitectura: DISTRITO → ZONA → SUBZONA (normalizada)

## Objetivo

Normalizar la estructura de zonas geográficas en Madrid para:
- Búsquedas rápidas sin JOINs costosos (denormalizadas en `listings` y `property`)
- Scraping dirigido por subzona
- Análisis de mercado por nivel administrativo
- Mitigar el tope de 1.800 resultados de Idealista mediante subdivisión granular

## Entidades

### `districts` (Distritos)

21 distritos administrativos de Madrid capital.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | PK |
| `code` | text | Código oficial (001–021) |
| `name` | text | "Chamberí", "Salamanca", etc. |
| `slug` | text | URL-friendly: "chamberi", "salamanca" |
| `city` | text | "Madrid" (para futuras ciudades) |
| `description` | text | Descripción opcional |
| `created_at`, `updated_at` | timestamptz | |

**Índices:**
- `idx_districts_code`: búsqueda por código oficial
- `idx_districts_slug`: búsqueda por slug (URLs)

**Seed data:** 21 filas (una por distrito oficial de Madrid)

### `zones` (Barrios/Áreas)

Divisiones dentro de un distrito. Equivale a los "barrios" tradicionales.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | PK |
| `name` | text | "Barrio de Salamanca", "Almagro", etc. |
| `district_id` | UUID FK | Distrito padre |
| `slug` | text | URL-friendly: "barrio-salamanca" |
| `idealista_slug` | text | "madrid/barrio-de-salamanca" (para construir URL de búsqueda) |
| `fotocasa_slug` | text | Equivalente en Fotocasa |
| `is_scrape_target` | bool | ¿Es objetivo de scraping directo? |
| `search_result_cap` | int | Tope de resultados (def. 1.800) |
| `geom` | MultiPolygon | Límite administrativo (opcional) |
| `centroid` | Point | Centro de zona |
| `description` | text | |
| `created_at`, `updated_at` | timestamptz | |

**Índices:**
- `idx_zones_district`: búsqueda por distrito
- `idx_zones_slug`: búsqueda por slug
- `idx_zones_idealista_slug`: búsqueda por slug de Idealista (importante para scraper)
- `idx_zones_scrape_target`: filtrar zonas objetivo
- `idx_zones_geom`: búsquedas geoespaciales (Point-in-Polygon)

**Constraint:** `UNIQUE (district_id, slug)`

### `subzones` (Urbanizaciones/Subareas)

Subdivisiones dentro de una zona, para máxima granularidad.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | PK |
| `name` | text | "Vallehermoso", "Goya", "Paseo de Recoletos", etc. |
| `zone_id` | UUID FK | Zona padre |
| `slug` | text | URL-friendly |
| `idealista_slug` | text | "madrid/chamberi/vallehermoso" (si es objetivo independiente) |
| `is_scrape_target` | bool | ¿Scrape independiente si zona padre supera tope? |
| `bounds` | Polygon | Límite de subzona |
| `centroid` | Point | Centro |
| `description` | text | |
| `created_at`, `updated_at` | timestamptz | |

**Índices:**
- `idx_subzones_zone`: búsqueda por zona
- `idx_subzones_slug`: búsqueda por slug
- `idx_subzones_idealista_slug`: búsqueda por slug de Idealista
- `idx_subzones_scrape_target`: filtrar subzonas objetivo
- `idx_subzones_bounds`: búsquedas geoespaciales

**Constraint:** `UNIQUE (zone_id, slug)`

## Desnormalización en `listings` y `property`

Para evitar JOINs, se desnormalizan 3 columnas en ambas tablas:

```sql
ALTER TABLE listings ADD COLUMN IF NOT EXISTS district_id uuid REFERENCES districts(id);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS subzone_id uuid REFERENCES subzones(id);

ALTER TABLE property ADD COLUMN IF NOT EXISTS district_id uuid REFERENCES districts(id);
ALTER TABLE property ADD COLUMN IF NOT EXISTS subzone_id uuid REFERENCES subzones(id);
```

**Beneficios:**
- Query de "todos en Chamberí" = `WHERE district_id = xxx`
- Query de "todos en Barrio Salamanca del distrito Salamanca" = `WHERE district_id = xxx AND zone_id = yyy`
- Sin JOINs: ejecución más rápida, menos I/O

**Índices clave:**
```sql
CREATE INDEX idx_listings_district_zone_subzone_active
  ON listings(district_id, zone_id, subzone_id, is_active);

CREATE INDEX idx_property_district_zone_subzone
  ON property(district_id, zone_id, subzone_id) WHERE is_active;
```

## Ejemplos de queries

### Todos los inmuebles en un DISTRITO

```sql
SELECT * FROM listings
WHERE district_id = (SELECT id FROM districts WHERE slug = 'chamberi')
  AND is_active = true
  AND operation = 'rent';
```

**Sin JOINs.** Usa índice `idx_listings_district_zone_subzone_active`.

### Todos en una ZONA (dentro de un distrito)

```sql
SELECT * FROM listings
WHERE zone_id = (SELECT id FROM zones WHERE slug = 'barrio-salamanca')
  AND is_active = true;
```

**Índice:** `idx_listings_zone` (ya existe en schema).

### Todos en una SUBZONA

```sql
SELECT * FROM listings
WHERE subzone_id = (SELECT id FROM subzones WHERE slug = 'goya')
  AND is_active = true;
```

**Índice:** `idx_listings_subzone`.

### CON JOINs para etiquetado

```sql
SELECT
  l.id, l.price, l.bedrooms,
  d.name AS district, z.name AS zone, sz.name AS subzone
FROM listings l
LEFT JOIN districts d ON l.district_id = d.id
LEFT JOIN zones z ON l.zone_id = z.id
LEFT JOIN subzones sz ON l.subzone_id = sz.id
WHERE l.district_id = (SELECT id FROM districts WHERE slug = 'salamanca')
  AND l.is_active = true;
```

## Scraper: Cómo se asignan IDs

Cuando `scrape-zone.mjs` ejecuta un scraping:

```bash
node scrape-zone.mjs --zone madrid/barrio-de-salamanca/goya --op rent
```

1. **Input:** `ZONE = 'madrid/barrio-de-salamanca/goya'`
2. **Enriquecimiento:** Se descarga la ficha completa; el HTML contiene `zone_raw = 'Barrio de Salamanca'` (u otro valor)
3. **Resolución:** `resolveZone(client, ZONE, zone_raw)` parsea:
   - `'madrid/barrio-de-salamanca/goya'.split('/')` → `['madrid', 'barrio-de-salamanca', 'goya']`
   - Busca `districts.slug = 'salamanca'` → `district_id`
   - Busca `zones.slug = 'barrio-salamanca'` en ese distrito → `zone_id`
   - Busca `subzones.slug = 'goya'` en esa zona → `subzone_id`
4. **Upsert:** INSERT/UPDATE en `listings` con `district_id`, `zone_id`, `subzone_id` ya asignados

**Resultado:** Cada anuncio nuevo tiene **automáticamente** sus IDs normalizados.

## Migración de datos históricos

Para anuncios ya en BD con `zone_raw` pero sin `district_id`, `zone_id`, `subzone_id`:

```sql
-- 1. Asignar zone_id basado en zone_raw
UPDATE listings l
SET zone_id = z.id
FROM zones z
WHERE l.zone_id IS NULL
  AND l.zone_raw ILIKE '%' || z.slug || '%'
  AND l.is_active = true;

-- 2. Asignar district_id desde zone_id
UPDATE listings l
SET district_id = d.id
FROM zones z
JOIN districts d ON z.district_id = d.id
WHERE l.zone_id = z.id
  AND l.district_id IS NULL;

-- 3. Asignar subzone_id si zone_raw menciona subzone
UPDATE listings l
SET subzone_id = sz.id
FROM zones z
JOIN subzones sz ON sz.zone_id = z.id
WHERE l.zone_id = z.id
  AND l.subzone_id IS NULL
  AND l.zone_raw ILIKE '%' || sz.slug || '%';
```

Validar completitud:
```sql
SELECT
  COUNT(*) AS total,
  COUNT(DISTINCT CASE WHEN district_id IS NOT NULL THEN id END) AS with_district,
  COUNT(DISTINCT CASE WHEN zone_id IS NOT NULL THEN id END) AS with_zone,
  COUNT(DISTINCT CASE WHEN subzone_id IS NOT NULL THEN id END) AS with_subzone
FROM listings WHERE is_active = true;
```

## Análisis: Zonas que superan tope de resultados

Si una zona en Idealista tiene >1.800 anuncios, el orquestador puede:
1. **Subdividir por precio:** Scrapear `madrid/barrio-de-salamanca?price=1000-1500`, etc.
2. **Subdividir por subzona:** Si existen `subzones.is_scrape_target = true`, scrapear cada subzona independientemente

Query para detectar zonas problemáticas:
```sql
SELECT
  d.name, z.name, z.idealista_slug,
  COUNT(*) AS current_listings,
  z.search_result_cap,
  CASE
    WHEN COUNT(*) > z.search_result_cap THEN 'SUBDIVIDE'
    ELSE 'OK'
  END AS action
FROM zones z
JOIN districts d ON z.district_id = d.id
LEFT JOIN listings l ON l.zone_id = z.id AND l.is_active = true
GROUP BY d.id, d.name, z.id, z.name, z.idealista_slug, z.search_result_cap
ORDER BY current_listings DESC;
```

## Compatibilidad hacia atrás

### Si código viejo depende de `zones` (tabla antigua 4-niveles)

La tabla vieja `zones` se mantiene **en paralelo** por ahora. Para compatibilidad:

```sql
CREATE OR REPLACE VIEW v_listing_locations AS
SELECT
  l.id AS listing_id,
  l.district_id, l.zone_id, l.subzone_id,
  d.name AS district_name, z.name AS zone_name, sz.name AS subzone_name,
  COALESCE(sz.idealista_slug, z.idealista_slug) AS idealista_slug,
  d.slug AS district_slug, z.slug AS zone_slug, sz.slug AS subzone_slug
FROM listings l
LEFT JOIN districts d ON l.district_id = d.id
LEFT JOIN zones z ON l.zone_id = z.id
LEFT JOIN subzones sz ON l.subzone_id = sz.id;
```

Código que lee desde `v_listing_locations` sigue funcionando sin cambios.

## Estadísticas iniciales

Seed data de `0019_normalized_district_zone_subzone.sql`:

| Entidad | Cantidad |
|---------|----------|
| Distritos | 21 |
| Zonas | 9 (Salamanca: 4, Chamberí: 5, Retiro: 2) |
| Subzonas | 14 (dentro de las 9 zonas) |

**Ampliable:** Agregar más zonas/subzonas conforme se scrapean nuevas áreas.

## Hoja de ruta

1. **Fase 1 (AHORA):** Crear tablas normalizadas + seed para Salamanca, Chamberí, Retiro
2. **Fase 2:** Actualizar scraper con `zone-resolver.mjs`
3. **Fase 3:** Migrar datos históricos (script queries-example.sql)
4. **Fase 4:** Expandir seed data a otros distritos según necesidad
5. **Fase 5 (opcional):** Deprecar tabla vieja `zones`, usar solo la nueva estructura

## Notas técnicas

- **PostGIS:** Ya tenemos soporte geoespacial (columnas `geom`, `bounds`). Usar `ST_Contains()` para Point-in-Polygon si es necesario.
- **Slug unicidad:** Los slugs son únicos dentro de su contexto (ej: `UNIQUE(district_id, slug)` en zonas).
- **NULL-safety:** Todas las columnas nuevas son NULLABLE, backcompat garantizada.
- **Índices:** Creados junto a la migración, no requieren mantenimiento manual.
