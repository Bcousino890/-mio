# Guía de Implementación: DISTRITO → ZONA → SUBZONA

## Overview

Pasos para implementar la estructura normalizada de distritos, zonas y subzonas en la BD.

**Archivos creados:**
- `db/migrations/0019_normalized_district_zone_subzone.sql` - Migraciones SQL
- `db/queries-example.sql` - Queries de ejemplo + migración de datos históricos
- `db/NORMALIZED_ZONES_ARCHITECTURE.md` - Arquitectura y decisiones
- `scraper/lib/zone-resolver.mjs` - Resolver para asignar IDs en el scraper
- `scraper/SCRAPER_INTEGRATION.md` - Cómo integrar el resolver en el scraper
- `db/test-zone-resolution.mjs` - Tests de validación

---

## FASE 1: Crear las tablas normalizadas

### Paso 1.1: Ejecutar la migración

```bash
psql $DATABASE_URL -f db/migrations/0019_normalized_district_zone_subzone.sql
```

**Qué hace:**
- Crea tabla `districts` (21 distritos de Madrid)
- Crea tabla `zones` (barrios)
- Crea tabla `subzones` (urbanizaciones)
- Agrega columnas `district_id`, `subzone_id` a `property` y `listings`
- Crea índices para búsquedas rápidas
- Seed initial: 21 distritos + 9 zonas + 14 subzonas

### Paso 1.2: Validar que se crearon correctamente

```bash
psql $DATABASE_URL -c "SELECT COUNT(*) FROM districts;"
# Debería mostrar: 21

psql $DATABASE_URL -c "SELECT COUNT(*) FROM zones;"
# Debería mostrar: 9

psql $DATABASE_URL -c "SELECT COUNT(*) FROM subzones;"
# Debería mostrar: 14
```

---

## FASE 2: Migrar datos históricos

Si ya tienes anuncios en `listings` con `zone_raw` pero sin `district_id`/`zone_id`/`subzone_id`:

### Paso 2.1: Ejecutar migración de datos históricos

```bash
psql $DATABASE_URL << 'SQL'
-- Asignar zone_id basado en zone_raw
UPDATE listings l
SET zone_id = z.id
FROM zones z
WHERE l.zone_id IS NULL
  AND l.zone_raw ILIKE '%' || z.slug || '%'
  AND l.is_active = true;

-- Asignar district_id desde zone_id
UPDATE listings l
SET district_id = d.id
FROM zones z
JOIN districts d ON z.district_id = d.id
WHERE l.zone_id = z.id
  AND l.district_id IS NULL;

-- Asignar subzone_id si zone_raw menciona subzona
UPDATE listings l
SET subzone_id = sz.id
FROM zones z
JOIN subzones sz ON sz.zone_id = z.id
WHERE l.zone_id = z.id
  AND l.subzone_id IS NULL
  AND l.zone_raw ILIKE '%' || sz.slug || '%';
SQL
```

### Paso 2.2: Validar completitud

```bash
psql $DATABASE_URL << 'SQL'
SELECT
  COUNT(*) AS total_listings,
  COUNT(DISTINCT CASE WHEN district_id IS NOT NULL THEN id END) AS with_district,
  COUNT(DISTINCT CASE WHEN zone_id IS NOT NULL THEN id END) AS with_zone,
  COUNT(DISTINCT CASE WHEN subzone_id IS NOT NULL THEN id END) AS with_subzone,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN district_id IS NOT NULL THEN id END) / COUNT(*), 1) AS pct_district,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN zone_id IS NOT NULL THEN id END) / COUNT(*), 1) AS pct_zone,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN subzone_id IS NOT NULL THEN id END) / COUNT(*), 1) AS pct_subzone
FROM listings
WHERE is_active = true;
SQL
```

Expected output:
```
 total_listings | with_district | with_zone | with_subzone | pct_district | pct_zone | pct_subzone
────────────────┼───────────────┼───────────┼──────────────┼──────────────┼──────────┼─────────────
           2500 |          2500 |      2500 |         1200 |        100.0 |    100.0 |        48.0
```

Si el porcentaje es <100%, hay anuncios sin mapeo. Revisar `zone_raw` para agregar más zonas/subzonas.

---

## FASE 3: Integrar el scraper con zone-resolver

### Paso 3.1: Copiar `zone-resolver.mjs`

Ya está en `scraper/lib/zone-resolver.mjs` (creado en este plan).

### Paso 3.2: Actualizar `scrape-zone.mjs`

Seguir las instrucciones en `scraper/SCRAPER_INTEGRATION.md`:

1. Importar el resolver:
   ```javascript
   import { ZoneResolverCache } from './lib/zone-resolver.mjs'
   ```

2. En `main()`, crear la cache:
   ```javascript
   const zoneResolverCache = new ZoneResolverCache()
   ```

3. Modificar `upsertOne()` para resolver zonas (ver archivo SCRAPER_INTEGRATION.md para el código exacto)

4. Pasar la cache al llamar `upsertOne()`:
   ```javascript
   const wasInserted = await upsertOne(dbClient, detail, zoneResolverCache, ZONE)
   ```

### Paso 3.3: Test del scraper actualizado

```bash
# Dry run para validar sin escribir
node scraper/scrape-zone.mjs --zone madrid/barrio-de-salamanca --op rent --dry-run --limit 3
```

En el output verás:
```
▶ Scrape madrid/barrio-de-salamanca · rent · DRY-RUN
  · 5000 resultados declarados en madrid/barrio-de-salamanca (rent)
  ✓ [1/3] 12345678 · 1500 € · 75 m² · 5 fotos · geo✓
  ✓ [2/3] 87654321 · 2000 € · 90 m² · 3 fotos · geo✓
  ✓ [3/3] 55555555 · 1800 € · 85 m² · 4 fotos · geo✓
```

Si ves errores como `[zone-resolver] Zona no encontrada`, significa que esa zona no existe en la BD. Agregar a `db/migrations/0019_*.sql` en sección SEED.

### Paso 3.4: Test del resolver directamente

```bash
node db/test-zone-resolution.mjs
```

Expected output:
```
═══════════════════════════════════════════════════════════════
TESTS: Zone Resolution (normalizado)
═══════════════════════════════════════════════════════════════

▶ Test: madrid/barrio-de-salamanca/goya (completa)
  idealista_slug: madrid/barrio-de-salamanca/goya
  zone_raw: Barrio de Salamanca
  → district_id: uuid-xxxx
  → zone_id: uuid-yyyy
  → subzone_id: uuid-zzzz
  ✓ PASS

[... más tests ...]

═══════════════════════════════════════════════════════════════
RESULTADO: 6 passed, 0 failed
═══════════════════════════════════════════════════════════════
```

---

## FASE 4: Scrapear con la nueva estructura

### Paso 4.1: Scrapear una zona (producción)

```bash
node scraper/scrape-zone.mjs --zone madrid/barrio-de-salamanca/goya --op rent
```

Cada anuncio se insertará con `district_id`, `zone_id`, `subzone_id` ya asignados.

Validar:
```bash
psql $DATABASE_URL -c "
  SELECT
    COUNT(*) AS total,
    COUNT(DISTINCT CASE WHEN district_id IS NOT NULL THEN 1 END) AS with_district,
    COUNT(DISTINCT CASE WHEN zone_id IS NOT NULL THEN 1 END) AS with_zone,
    COUNT(DISTINCT CASE WHEN subzone_id IS NOT NULL THEN 1 END) AS with_subzone
  FROM listings
  WHERE zone_raw LIKE '%barrio-de-salamanca%'
    AND is_active = true;
"
```

### Paso 4.2: Queries de validación

Probar queries de ejemplo:

```bash
# Todos en Chamberí
psql $DATABASE_URL << 'SQL'
SELECT COUNT(*) FROM listings
WHERE district_id = (SELECT id FROM districts WHERE slug = 'chamberi')
  AND is_active = true;
SQL

# Todos en Barrio Salamanca
psql $DATABASE_URL << 'SQL'
SELECT COUNT(*) FROM listings
WHERE zone_id = (SELECT id FROM zones WHERE slug = 'barrio-salamanca')
  AND is_active = true;
SQL

# Todos en Goya (subzona)
psql $DATABASE_URL << 'SQL'
SELECT COUNT(*) FROM listings
WHERE subzone_id = (SELECT id FROM subzones WHERE slug = 'goya')
  AND is_active = true;
SQL
```

---

## FASE 5: Ampliar seed data (opcional)

Si necesitas agregar más distritos/zonas/subzonas:

### Paso 5.1: Agregar nueva zona

```sql
INSERT INTO zones (name, district_id, slug, idealista_slug, is_scrape_target)
  SELECT 'Nueva Zona', id, 'nueva-zona', 'madrid/nueva-zona', true
  FROM districts WHERE code = '005'  -- Chamberí
ON CONFLICT (district_id, slug) DO NOTHING;
```

### Paso 5.2: Agregar subzonas de esa zona

```sql
INSERT INTO subzones (name, zone_id, slug, is_scrape_target)
  SELECT 'Subzona A', id, 'subzona-a', false
  FROM zones WHERE slug = 'nueva-zona'
ON CONFLICT (zone_id, slug) DO NOTHING;
```

### Paso 5.3: Crear migración oficial

Agregárselo a `db/migrations/0019_normalized_district_zone_subzone.sql` (sección SEED) si es data permanente.

---

## FASE 6: Dashboard / Análisis

### Queries útiles

Ver todos los distritos con conteo de anuncios:

```bash
psql $DATABASE_URL << 'SQL'
SELECT
  d.name,
  COUNT(*) AS listing_count,
  ROUND(AVG(l.price)) AS avg_price_rent
FROM districts d
LEFT JOIN listings l ON d.id = l.district_id AND l.is_active = true AND l.operation = 'rent'
GROUP BY d.id, d.name
ORDER BY listing_count DESC;
SQL
```

Zonas que superan tope de resultados:

```bash
psql $DATABASE_URL << 'SQL'
SELECT
  d.name, z.name, COUNT(*) AS listing_count, z.search_result_cap,
  CASE WHEN COUNT(*) > z.search_result_cap THEN 'SUBDIVIDIR' ELSE 'OK' END
FROM zones z
JOIN districts d ON z.district_id = d.id
LEFT JOIN listings l ON z.id = l.zone_id AND l.is_active = true
GROUP BY d.id, d.name, z.id, z.name, z.search_result_cap
ORDER BY listing_count DESC;
SQL
```

---

## Troubleshooting

### Q: "Zona no encontrada" en logs del scraper

**R:** El `idealista_slug` que pasaste al scraper no existe en BD. Agregar a SEED data:

```sql
INSERT INTO zones (name, district_id, slug, idealista_slug, is_scrape_target)
  SELECT 'Nuevo Barrio', id, 'nuevo-barrio', 'madrid/nuevo-barrio', true
  FROM districts WHERE code = 'XXX'
ON CONFLICT (district_id, slug) DO NOTHING;
```

### Q: "Porcentaje de zone_id asignados es <100%"

**R:** Hay `zone_raw` que no matchean con los slugs en BD. Revisar:

```bash
psql $DATABASE_URL << 'SQL'
SELECT DISTINCT zone_raw
FROM listings
WHERE zone_id IS NULL AND is_active = true
ORDER BY zone_raw;
SQL
```

Luego agregar esas zonas a la BD o mejorar la lógica de matching en `zone-resolver.mjs`.

### Q: "Cache no funciona" en tests

**R:** Verificar que el ZoneResolverCache no se está limpiando entre llamadas. Usar instancia global.

---

## Checklist de implementación

- [ ] Ejecutar migración `0019_normalized_district_zone_subzone.sql`
- [ ] Validar que se crearon 21 distritos, 9 zonas, 14 subzonas
- [ ] Migrar datos históricos (UPDATE listings con district_id, zone_id, subzone_id)
- [ ] Validar completitud (>90% de listings con district_id/zone_id)
- [ ] Copiar `zone-resolver.mjs` a `scraper/lib/`
- [ ] Actualizar `scrape-zone.mjs` con resolver (ver SCRAPER_INTEGRATION.md)
- [ ] Test: `node db/test-zone-resolution.mjs` (todos deben pasar)
- [ ] Test: `node scraper/scrape-zone.mjs --zone madrid/barrio-de-salamanca --op rent --dry-run --limit 3`
- [ ] Scrapear una zona pequeña y validar que district_id, zone_id, subzone_id están asignados
- [ ] Ejecutar queries de ejemplo (COUNT por distrito, zona, subzona)
- [ ] Ampliar seed data con más distritos si es necesario
- [ ] Documentar cambios (README scraper, etc.)

---

## Performance esperado

Después de implementar:

| Query | Sin índice | Con índice | Mejora |
|-------|-----------|-----------|--------|
| Todos en distrito | 5-10s | 100-200ms | 50-100x |
| Todos en zona | 3-5s | 50-100ms | 50-100x |
| Todos en subzona | 2-3s | 20-50ms | 50-100x |
| Distrito + zona + subzona | 8-15s | 100-300ms | 50-100x |

*Estimación con 100k+ anuncios.*

---

## Notas finales

- **Backward compatibility:** `zone_raw` se mantiene; columnas nuevas son NULLABLE
- **Tabla vieja `zones`:** Puede quedarse en paralelo mientras se migran datos, luego deprecar
- **Geoespacial:** Si cargas `geom`/`bounds` en futuro, habilita Point-in-Polygon
- **Escalabilidad:** Estructura soporta millones de anuncios con índices adecuados
