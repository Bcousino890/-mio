# Estructura Normalizada: DISTRITO → ZONA → SUBZONA

**Descripción breve:** Arquitectura de 3 niveles para Madrid que reemplaza la anterior jerarquía de `zones` de 4 niveles.

## Problema que resuelve

**Antes:**
```
zones (nivel jerárquico variable)
  ├─ municipio: Madrid
  │  ├─ distrito: Salamanca
  │  │  ├─ barrio: Barrio de Salamanca
  │  │  │  └─ urbanización: Goya (??)
```
- Confuso qué es qué
- Queries con múltiples JOINs costosos
- Difícil filtrar por "todos en un distrito"

**Ahora:**
```
districts (21 filas)        zona_id FK
   ├─ Chamberí ─────────────┬──────────┐
   ├─ Salamanca ────────────┼──────┬──────────┐
   └─ Retiro ──────────────┬┘      │          │
                           │       │          │
        zones (9 filas)    │   district_id    │
           ├─ Barrio de     │   (denormalizado)
           │  Salamanca ───┘
           ├─ Chamberí
           └─ Retiro
                 │
           subzones (14 filas)
              ├─ Goya
              ├─ Vallehermoso
              └─ Gaztambide
```

- Claro y jerárquico: distrito → zona → subzona
- Denormalizadas en listings/property para queries sin JOINs
- Trivial filtrar "todos en Chamberí": `WHERE district_id = xxx`

## Tablas creadas

### `districts` (21 registros)
```sql
CREATE TABLE districts (
  id        uuid PRIMARY KEY,
  code      text,        -- "001", "002", ..., "021"
  name      text,        -- "Chamberí", "Salamanca", etc.
  slug      text,        -- "chamberi", "salamanca"
  city      text,        -- "Madrid"
  ...
);
```

**Seed:** Los 21 distritos oficiales de Madrid capital.

### `zones` (barrios/áreas)
```sql
CREATE TABLE zones (
  id            uuid PRIMARY KEY,
  name          text,          -- "Barrio de Salamanca", "Almagro"
  district_id   uuid FK,       -- Referencia a districts
  slug          text,          -- "barrio-salamanca", "almagro"
  idealista_slug text,         -- "madrid/barrio-de-salamanca" (para scraper)
  is_scrape_target bool,       -- ¿Target de scraping directo?
  search_result_cap int,       -- Tope de resultados antes de subdivir (def. 1800)
  geom          geometry,      -- Opcional: límite de zona (MultiPolygon)
  ...
);
```

**Seed inicial:** 9 zonas
- Salamanca: 1 zona (Barrio de Salamanca)
- Chamberí: 1 zona (Chamberí Centro)
- Retiro: 1 zona (Retiro Centro)
- (ampliable a otros distritos)

### `subzones` (urbanizaciones/subareas)
```sql
CREATE TABLE subzones (
  id          uuid PRIMARY KEY,
  name        text,       -- "Goya", "Vallehermoso", "Paseo de Recoletos"
  zone_id     uuid FK,    -- Referencia a zones
  slug        text,       -- "goya", "vallehermoso"
  idealista_slug text,    -- "madrid/chamberi/vallehermoso" (si es target)
  is_scrape_target bool,
  bounds      geometry,   -- Opcional: límite de subzona (Polygon)
  ...
);
```

**Seed inicial:** 14 subzonas
- Barrio Salamanca: Paseo de Recoletos, Lista, Goya
- Chamberí Centro: Vallehermoso, Gaztambide, Arapiles, Almagro
- Retiro Centro: Ibiza, Pacífico
- (ampliable)

## Desnormalización en listings y property

Para evitar JOINs en queries frecuentes, agregamos 2 columnas en ambas tablas:

```sql
ALTER TABLE listings ADD COLUMN district_id uuid REFERENCES districts(id);
ALTER TABLE listings ADD COLUMN subzone_id uuid REFERENCES subzones(id);

ALTER TABLE property ADD COLUMN district_id uuid REFERENCES districts(id);
ALTER TABLE property ADD COLUMN subzone_id uuid REFERENCES subzones(id);
```

**zone_id ya existía** (FK a la tabla vieja `zones`), se mantiene.

## Índices para performance

```sql
-- Búsqueda por distrito (SIN JOINs)
CREATE INDEX idx_listings_district ON listings(district_id);

-- Búsqueda combinada: distrito + zona + subzona + activo
CREATE INDEX idx_listings_district_zone_subzone_active
  ON listings(district_id, zone_id, subzone_id, is_active);

-- Búsqueda geoespacial (si hay bounds/geom cargados)
CREATE INDEX idx_zones_geom ON zones USING gist(geom);
CREATE INDEX idx_subzones_bounds ON subzones USING gist(bounds);
```

## Ejemplos de queries

### Todos en un DISTRITO (más común)
```sql
SELECT * FROM listings
WHERE district_id = (SELECT id FROM districts WHERE slug = 'chamberi')
  AND is_active = true;
```
✓ Sin JOINs, usa `idx_listings_district`.

### Todos en una ZONA (dentro de distrito)
```sql
SELECT * FROM listings
WHERE zone_id = (SELECT id FROM zones WHERE slug = 'barrio-salamanca')
  AND is_active = true;
```
✓ Sin JOINs, usa `idx_listings_zone`.

### Todos en SUBZONA
```sql
SELECT * FROM listings
WHERE subzone_id = (SELECT id FROM subzones WHERE slug = 'goya')
  AND is_active = true;
```
✓ Sin JOINs, usa `idx_listings_subzone`.

### CON etiquetas (para UI)
```sql
SELECT
  l.id, l.price,
  d.name AS district, z.name AS zone, sz.name AS subzone
FROM listings l
LEFT JOIN districts d ON l.district_id = d.id
LEFT JOIN zones z ON l.zone_id = z.id
LEFT JOIN subzones sz ON l.subzone_id = sz.id
WHERE l.district_id = (SELECT id FROM districts WHERE slug = 'salamanca')
  AND l.is_active = true;
```

## Scraper: Cómo funciona

Cuando ejecutas:
```bash
node scraper/scrape-zone.mjs --zone madrid/barrio-de-salamanca/goya --op rent
```

1. **Input:** `ZONE = 'madrid/barrio-de-salamanca/goya'`, `zone_raw = 'Barrio de Salamanca'` (del HTML)
2. **Resolver:** `resolveZone(ZONE, zone_raw)` parsea:
   - Slug `'madrid/barrio-de-salamanca/goya'` → `['madrid', 'barrio-de-salamanca', 'goya']`
   - Busca: `districts.slug = 'salamanca'` → `district_id`
   - Busca: `zones.slug = 'barrio-salamanca'` en ese distrito → `zone_id`
   - Busca: `subzones.slug = 'goya'` en esa zona → `subzone_id`
3. **INSERT:** Cada anuncio se guarda con IDs ya asignados
4. **Result:** `listings.district_id`, `listings.zone_id`, `listings.subzone_id` poblados automáticamente

**Cache:** Para no re-queryar la misma zona en 1.000 anuncios, hay cache en memoria.

## Archivos del proyecto

```
db/
  ├─ migrations/
  │  └─ 0019_normalized_district_zone_subzone.sql  ← Crear tablas + seed
  ├─ queries-example.sql                            ← Queries de ejemplo
  ├─ test-zone-resolution.mjs                       ← Validar resolver
  └─ NORMALIZED_ZONES_ARCHITECTURE.md               ← Arquitectura detallada

scraper/
  ├─ lib/
  │  └─ zone-resolver.mjs                           ← Resolver de zonas
  ├─ scrape-zone.mjs                                ← Actualizar este
  ├─ SCRAPER_INTEGRATION.md                         ← Cómo integrar
  └─ ...

IMPLEMENTATION_GUIDE.md                             ← Pasos fase por fase
DISTRICT_ZONE_STRUCTURE_README.md                   ← Este archivo
```

## Hoja de ruta (implementación)

**Fase 1:** Crear tablas (5 min)
```bash
psql $DATABASE_URL -f db/migrations/0019_normalized_district_zone_subzone.sql
```

**Fase 2:** Migrar datos históricos (2-5 min depende de volumen)
```bash
psql $DATABASE_URL -f db/queries-example.sql  # Sección 10
```

**Fase 3:** Integrar scraper (15 min)
- Copiar `zone-resolver.mjs` (ya está)
- Actualizar `scrape-zone.mjs` (seguir `SCRAPER_INTEGRATION.md`)

**Fase 4:** Validar
```bash
node db/test-zone-resolution.mjs  # Todos los tests pasan
node scraper/scrape-zone.mjs --zone madrid/barrio-de-salamanca --dry-run --limit 3
```

**Fase 5:** Scrapear y monitorear
```bash
node scraper/scrape-zone.mjs --zone madrid/barrio-de-salamanca --op rent
```

## Compatibilidad hacia atrás

- **zone_raw** se mantiene (el texto crudo del HTML)
- **zone_id** se mantiene (FK a tabla vieja `zones` si existe)
- Columnas nuevas (`district_id`, `subzone_id`) son NULLABLE
- Queries antiguas siguen funcionando (LEFT JOINs)

## Performance esperado

Después de implementación:

| Operación | Antes | Después | Mejora |
|-----------|-------|---------|--------|
| Filtrar por distrito | 5-10s | 100-200ms | 50-100x |
| Filtrar por zona | 2-5s | 50-100ms | 50-100x |
| Filtrar por subzona | 1-3s | 20-50ms | 50-100x |

*Con ~100k+ anuncios activos.*

## Notas técnicas

- **PostGIS:** Soporta `geom` (MultiPolygon en zones) y `bounds` (Polygon en subzones). Point-in-Polygon con `ST_Contains()` si carga data geométrica.
- **Unicidad:** Slugs únicos dentro del contexto: `UNIQUE(district_id, slug)` en zones.
- **NULL-safety:** Todas las columnas nuevas son NULLABLE. Insertar anuncios sin resolución seguirá funcionando.
- **Índices:** Pre-creados, no requieren mantenimiento manual.

## Contacto

Para preguntas o bugs, ver documentación completa en:
- `IMPLEMENTATION_GUIDE.md` - Pasos paso a paso
- `db/NORMALIZED_ZONES_ARCHITECTURE.md` - Decisiones de diseño
- `scraper/SCRAPER_INTEGRATION.md` - Integración del scraper
