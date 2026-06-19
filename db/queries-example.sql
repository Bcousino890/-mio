-- ═════════════════════════════════════════════════════════════════════════════
-- EJEMPLO DE QUERIES con la estructura normalizada
-- DISTRITO → ZONA → SUBZONA
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Todos los inmuebles en un DISTRITO (Chamberí)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  l.id, l.external_id, l.price, l.bedrooms, l.square_meters,
  l.address, l.zone_id, l.district_id, l.subzone_id,
  d.name AS district_name, z.name AS zone_name, sz.name AS subzone_name
FROM listings l
LEFT JOIN districts d ON l.district_id = d.id
LEFT JOIN zones z ON l.zone_id = z.id
LEFT JOIN subzones sz ON l.subzone_id = sz.id
WHERE l.district_id = (SELECT id FROM districts WHERE slug = 'chamberi')
  AND l.is_active = true
  AND l.operation = 'rent'
ORDER BY l.price DESC
LIMIT 100;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Todos los inmuebles en una ZONA (Barrio de Salamanca)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  l.id, l.external_id, l.price, l.bedrooms, l.square_meters,
  d.name AS district, z.name AS zone, sz.name AS subzone
FROM listings l
LEFT JOIN districts d ON l.district_id = d.id
LEFT JOIN zones z ON l.zone_id = z.id
LEFT JOIN subzones sz ON l.subzone_id = sz.id
WHERE l.zone_id = (SELECT id FROM zones WHERE slug = 'barrio-salamanca')
  AND l.is_active = true
ORDER BY l.updated_at DESC;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Todos en una SUBZONA (Goya, Almagro, etc.)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  l.id, l.external_id, l.price, l.bedrooms, l.square_meters, l.address,
  d.name AS district, z.name AS zone, sz.name AS subzone
FROM listings l
LEFT JOIN districts d ON l.district_id = d.id
LEFT JOIN zones z ON l.zone_id = z.id
LEFT JOIN subzones sz ON l.subzone_id = sz.id
WHERE l.subzone_id = (SELECT id FROM subzones WHERE slug = 'goya')
  AND l.is_active = true
ORDER BY l.price;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Combinada: Distrito + Zona
-- ─────────────────────────────────────────────────────────────────────────────
-- "Todos los inmuebles en el Barrio de Salamanca del distrito de Salamanca"
SELECT
  l.id, l.external_id, l.price, l.bedrooms, l.square_meters,
  d.name, z.name
FROM listings l
LEFT JOIN districts d ON l.district_id = d.id
LEFT JOIN zones z ON l.zone_id = z.id
WHERE l.district_id = (SELECT id FROM districts WHERE slug = 'salamanca')
  AND l.zone_id = (SELECT id FROM zones WHERE slug = 'barrio-salamanca')
  AND l.is_active = true
  AND l.operation = 'sale'
ORDER BY l.price;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Conteo: Inmuebles activos por ZONA
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  d.name AS district,
  z.name AS zone,
  COUNT(*) AS listing_count,
  MIN(l.price) AS price_min,
  AVG(l.price) AS price_avg,
  MAX(l.price) AS price_max
FROM listings l
JOIN zones z ON l.zone_id = z.id
JOIN districts d ON z.district_id = d.id
WHERE l.is_active = true
  AND l.operation = 'rent'
GROUP BY d.id, d.name, z.id, z.name
ORDER BY listing_count DESC;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Conteo por SUBZONA
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  d.name AS district,
  z.name AS zone,
  sz.name AS subzone,
  COUNT(*) AS listing_count,
  ROUND(AVG(l.price)) AS avg_price
FROM listings l
LEFT JOIN districts d ON l.district_id = d.id
LEFT JOIN zones z ON l.zone_id = z.id
LEFT JOIN subzones sz ON l.subzone_id = sz.id
WHERE l.is_active = true
  AND l.operation = 'rent'
  AND d.name = 'Chamberí'  -- opcional: filtrar por distrito
GROUP BY d.id, d.name, z.id, z.name, sz.id, sz.name
ORDER BY listing_count DESC;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Búsqueda geoespacial: Point-in-Polygon
-- Si las zonas/subzonas tienen bounds cargados (geom)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  l.id, l.external_id, l.price, l.address,
  d.name, z.name, sz.name
FROM listings l
LEFT JOIN districts d ON l.district_id = d.id
LEFT JOIN zones z ON l.zone_id = z.id
LEFT JOIN subzones sz ON l.subzone_id = sz.id
WHERE l.is_active = true
  AND l.geom IS NOT NULL
  AND sz.bounds IS NOT NULL
  -- Punto-en-polígono: ¿el anuncio está dentro del bounds de la subzona?
  AND ST_Contains(sz.bounds, l.geom)
LIMIT 50;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Jerarquía completa: DISTRITO → ZONA → SUBZONA
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  d.code AS district_code,
  d.slug AS district_slug,
  d.name AS district_name,
  z.slug AS zone_slug,
  z.name AS zone_name,
  z.idealista_slug,
  z.is_scrape_target,
  sz.slug AS subzone_slug,
  sz.name AS subzone_name,
  sz.is_scrape_target AS subzone_scrape_target,
  COUNT(DISTINCT CASE WHEN l.is_active THEN l.id END) AS active_listings
FROM districts d
LEFT JOIN zones z ON z.district_id = d.id
LEFT JOIN subzones sz ON sz.zone_id = z.id
LEFT JOIN listings l ON (
  l.district_id = d.id
  AND (z.id IS NULL OR l.zone_id = z.id)
  AND (sz.id IS NULL OR l.subzone_id = sz.id)
)
WHERE d.code IN ('004', '005', '003')  -- Salamanca, Chamberí, Retiro
GROUP BY d.id, d.code, d.slug, d.name,
         z.id, z.slug, z.name, z.idealista_slug, z.is_scrape_target,
         sz.id, sz.slug, sz.name, sz.is_scrape_target
ORDER BY d.code, z.slug NULLS LAST, sz.slug NULLS LAST;


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Zonas que SUPERAN el tope de resultados (candidatas a subdividir)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  z.id, z.name, z.idealista_slug,
  COUNT(*) AS current_listings,
  z.search_result_cap AS cap,
  CASE
    WHEN COUNT(*) > z.search_result_cap THEN 'SUBDIVIDE O TROCE POR PRECIO'
    ELSE 'OK'
  END AS action
FROM zones z
LEFT JOIN listings l ON l.zone_id = z.id AND l.is_active = true
GROUP BY z.id, z.name, z.idealista_slug, z.search_result_cap
ORDER BY current_listings DESC;


-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Actualizar zone_id, district_id, subzone_id basado en "zone_raw"
-- (migración de datos desde la antigua tabla zones de 4 niveles)
-- ─────────────────────────────────────────────────────────────────────────────
-- Primero, mapeo: cómo relacionar zone_raw con la nueva estructura.
-- Ejemplo: si zone_raw = 'madrid/chamberi/almagro', buscamos:
--   - "chamberi" → district
--   - "almagro" → zona Y/O subzona
--
-- PASO 1: Poblacion de zone_id (si no está ya asignado)
UPDATE listings l
SET zone_id = z.id
FROM zones z
WHERE l.zone_id IS NULL
  AND l.zone_raw ILIKE '%' || z.slug || '%'
  AND l.is_active = true;

-- PASO 2: Poblacion de district_id
UPDATE listings l
SET district_id = d.id
FROM zones z
JOIN districts d ON z.district_id = d.id
WHERE l.zone_id = z.id
  AND l.district_id IS NULL;

-- PASO 3: Poblacion de subzone_id (si zone_raw menciona subnombre y existe subzona)
UPDATE listings l
SET subzone_id = sz.id
FROM zones z
JOIN subzones sz ON sz.zone_id = z.id
WHERE l.zone_id = z.id
  AND l.subzone_id IS NULL
  AND l.zone_raw ILIKE '%' || sz.slug || '%';


-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Vista auxiliar: para compatibilidad hacia atrás (legacy)
-- ─────────────────────────────────────────────────────────────────────────────
-- Si el código viejo aún depende de "zone_id → zones.idealista_slug", crear vista:
CREATE OR REPLACE VIEW v_listing_locations AS
SELECT
  l.id AS listing_id,
  l.district_id,
  l.zone_id,
  l.subzone_id,
  d.name AS district_name,
  z.name AS zone_name,
  sz.name AS subzone_name,
  COALESCE(sz.idealista_slug, z.idealista_slug) AS idealista_slug,
  d.slug AS district_slug,
  z.slug AS zone_slug,
  sz.slug AS subzone_slug
FROM listings l
LEFT JOIN districts d ON l.district_id = d.id
LEFT JOIN zones z ON l.zone_id = z.id
LEFT JOIN subzones sz ON l.subzone_id = sz.id;


-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Estadísticas: Completitud de la normalizacion
-- ─────────────────────────────────────────────────────────────────────────────
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
