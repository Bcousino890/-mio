# Integración del Scraper con la nueva estructura normalizada

## Cambios requeridos en `scrape-zone.mjs`

### 1. Importar el resolver de zonas

```javascript
import { ZoneResolverCache } from './lib/zone-resolver.mjs'
```

### 2. Inicializar el cache de zonas

En la función `main()`, antes de conectar a la BD:

```javascript
async function main() {
  // ... código existente ...
  const zoneResolverCache = new ZoneResolverCache()
  // ...
}
```

### 3. Modificar `upsertOne()` para resolver zonas

La función `upsertOne()` debe:
1. Llamar al resolver con el `idealista_slug` (ZONE) y `zone_raw`
2. Pasar los IDs resueltos al INSERT

**CAMBIO EN LA FIRMA:**

```javascript
async function upsertOne(client, r, zoneResolverCache, idealista_slug) {
  // Resolver zonas
  const zoneResolution = await zoneResolverCache.resolveWithCache(
    client,
    idealista_slug,
    r.zone_raw
  )

  const q = `
    INSERT INTO listings (
      portal, source_type, external_id, source_url, operation,
      advertiser_type, advertiser_name, phone, reference, price, bedrooms, bathrooms,
      square_meters, zone_raw, address, latitude, longitude, blur_radius_m,
      description, features, photos, cover_phash, photo_phashes,
      district_id, zone_id, subzone_id,  -- NUEVAS COLUMNAS
      status, is_active, last_seen_at, updated_at,
      agency_url, agency_crm, agency_reference_id, agency_domain,
      agency_photos, photo_source_status, agency_photo_count, agency_photos_fetched_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::jsonb,
      $22,$23,$24,  -- NUEVAS COLUMNAS
      'active', true, now(), now(),
      $25,$26,$27,$28,
      $29::jsonb, $30, $31, $32
    )
    ON CONFLICT (portal, external_id) DO UPDATE SET
      price = EXCLUDED.price,
      advertiser_type = EXCLUDED.advertiser_type,
      advertiser_name = EXCLUDED.advertiser_name,
      phone = EXCLUDED.phone,
      reference = EXCLUDED.reference,
      bedrooms = EXCLUDED.bedrooms,
      bathrooms = EXCLUDED.bathrooms,
      square_meters = EXCLUDED.square_meters,
      address = EXCLUDED.address,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      description = EXCLUDED.description,
      features = EXCLUDED.features,
      photos = EXCLUDED.photos,
      cover_phash = EXCLUDED.cover_phash,
      photo_phashes = EXCLUDED.photo_phashes,
      district_id = EXCLUDED.district_id,  -- NUEVAS COLUMNAS
      zone_id = EXCLUDED.zone_id,
      subzone_id = EXCLUDED.subzone_id,
      agency_url = EXCLUDED.agency_url,
      agency_crm = EXCLUDED.agency_crm,
      agency_reference_id = EXCLUDED.agency_reference_id,
      agency_domain = EXCLUDED.agency_domain,
      agency_photos = EXCLUDED.agency_photos,
      photo_source_status = EXCLUDED.photo_source_status,
      agency_photo_count = EXCLUDED.agency_photo_count,
      agency_photos_fetched_at = EXCLUDED.agency_photos_fetched_at,
      status = 'active', is_active = true,
      last_seen_at = now(), updated_at = now()
    RETURNING (xmax = 0) AS inserted`

  const vals = [
    r.portal, r.source_type, r.external_id, r.source_url, r.operation,
    r.advertiser_type, r.advertiser_name, r.phone, r.reference, r.price, r.bedrooms, r.bathrooms,
    r.square_meters, ZONE, r.address, r.latitude, r.longitude, r.blur_radius_m,
    r.description, JSON.stringify(r.features), JSON.stringify(r.photos),
    r.cover_phash, r.photo_phashes,
    zoneResolution.district_id, zoneResolution.zone_id, zoneResolution.subzone_id,  // NUEVOS
    r.agency_url, r.agency_crm, r.agency_reference_id, r.agency_domain,
    JSON.stringify(r.agency_photos || []), r.photo_source_status, r.agency_photo_count, r.agency_photos_fetched_at,
  ]

  const { rows: rr } = await client.query(q, vals)
  return !!rr[0]?.inserted
}
```

### 4. Actualizar la llamada en el loop

En el loop donde se procesan los anuncios:

```javascript
if (dbClient) {
  const wasInserted = await upsertOne(dbClient, detail, zoneResolverCache, ZONE)
  if (wasInserted) inserted++; else updated++
}
```

## Flujo de resolución

### Ejemplo: Scraper ejecuta `madrid/barrio-de-salamanca/goya`

```
Input:
  zoneSlug = 'madrid/barrio-de-salamanca/goya'
  zone_raw = 'Barrio de Salamanca' (del HTML)

Resolver:
  1. Parse slug → ['madrid', 'barrio-de-salamanca', 'goya']
  2. Buscar distrito 'salamanca' → district_id = uuid-xyz
  3. Buscar zona 'barrio-salamanca' en ese distrito → zone_id = uuid-abc
  4. Buscar subzona 'goya' en esa zona → subzone_id = uuid-def

Result:
  { district_id: uuid-xyz, zone_id: uuid-abc, subzone_id: uuid-def }

INSERT:
  listings (
    ...,
    zone_raw = 'madrid/barrio-de-salamanca/goya',
    district_id = uuid-xyz,
    zone_id = uuid-abc,
    subzone_id = uuid-def,
    ...
  )
```

## Backward compatibility

### Si zone_raw es NULL o malformado

El resolver devuelve `{ district_id: null, zone_id: null, subzone_id: null }` de forma segura.
Los INSERTs siguen funcionando (las columnas nuevas son NULLABLE).

### En queries, siempre usar LEFT JOINs

```sql
FROM listings l
LEFT JOIN districts d ON l.district_id = d.id
LEFT JOIN zones z ON l.zone_id = z.id
LEFT JOIN subzones sz ON l.subzone_id = sz.id
```

## Testing

Ejecutar el scraper en modo dry-run para validar resolución antes de escribir:

```bash
node scraper/scrape-zone.mjs --zone madrid/barrio-de-salamanca --op rent --dry-run --limit 3
```

Los logs mostrarán:
```
[zone-resolver] Resolviendo madrid/barrio-de-salamanca → district_id, zone_id, subzone_id
✓ [1/3] 12345678 · 1500 € · 75 m² · ...
```

## Migración de datos históricos

Usar el script en `db/queries-example.sql` sección 10 para rellenar retroactivamente
`district_id`, `zone_id`, `subzone_id` en anuncios ya insertados:

```bash
psql $DATABASE_URL -f db/queries-example.sql
```

Esto actualiza listing basado en `zone_raw` y `zone_id` existentes.

## Performance

- **ZoneResolverCache**: evita N queries por anuncio (típicamente 2-3 por zona)
- **Índices**: `idx_districts_slug`, `idx_zones_district_slug`, `idx_subzones_zone_slug`
- Para zonas con miles de anuncios: el cache se rellena en los primeros N anuncios
