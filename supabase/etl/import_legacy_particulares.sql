-- ─────────────────────────────────────────────────────────────────────────────
-- ETL · Importar los ~2500 particulares legacy (smartbc) → casafari-mio
-- ─────────────────────────────────────────────────────────────────────────────
-- REQUISITO PREVIO: haber restaurado el dump del VPS viejo en ESTE Postgres.
-- Como el esquema nuevo NO tiene tablas llamadas `particulares*`, el dump no
-- colisiona y se restaura tal cual en `public`. Pasos:
--
--   # 1) En el VPS VIEJO — generar el dump (solo las tablas de particulares):
--   pg_dump "$OLD_DB_URL" \
--     -t public.particulares -t public.particulares_changes -t public.particulares_contacts \
--     --no-owner --no-privileges -Fc -f casafari_legacy.dump
--
--   # 2) En el Postgres NUEVO — restaurar (crea las tablas legacy en public):
--   pg_restore --no-owner --no-privileges -d "$NEW_DB_URL" casafari_legacy.dump
--
--   # 3) Ejecutar ESTE script:
--   psql "$NEW_DB_URL" -f supabase/etl/import_legacy_particulares.sql
--
--   # 4) Verificar y, si todo OK, limpiar las tablas legacy:
--   #   DROP TABLE particulares_changes, particulares_contacts, particulares;
--
-- Idempotente: ON CONFLICT DO NOTHING en listings (por portal+external_id).
-- Algunas columnas legacy son opcionales (migraciones 0035/0036 del viejo:
-- phone_confidence, address, floor_plan_url, video_url, contact_name). Si tu
-- dump no las tiene, comenta esas líneas del SELECT.

BEGIN;

-- ── 1) particulares → listings ───────────────────────────────────────────────
INSERT INTO listings (
  portal, external_id, source_url,
  operation, advertiser_type, is_ad_professional,
  contact_name, phone,
  price, bedrooms, bathrooms, square_meters,
  zone_raw, subzone_raw, address,
  latitude, longitude,
  description, features, photos,
  status, is_active, detected_at, first_seen_at, last_seen_at, taken_down_at,
  created_at, updated_at
)
SELECT
  p.portal,
  p.external_id,
  p.source_url,
  p.operation,
  COALESCE(p.advertiser_type, 'unknown'),
  p.is_ad_professional,
  COALESCE(p.contact_name, p.owner_name),          -- contact_name si existe (0035), si no owner_name
  p.phone,
  p.price,
  p.bedrooms,
  p.bathrooms,
  p.square_meters,
  p.zone,                                          -- zona cruda → zone_raw
  p.subzone,
  p.address,                                       -- opcional (0035); comentar si no existe
  p.latitude,
  p.longitude,
  p.description,
  p.features,
  p.photos,
  CASE WHEN COALESCE(p.is_active, true) THEN 'active' ELSE 'gone' END,
  COALESCE(p.is_active, true),
  COALESCE(p.detected_at, p.created_at),
  p.created_at,                                    -- first_seen = alta original
  p.updated_at,
  p.taken_down_at,
  p.created_at,
  COALESCE(p.updated_at, p.created_at)
FROM particulares p
ON CONFLICT (portal, external_id) DO NOTHING;

-- Asignar zone_id casando zone_raw / subzone_raw con la taxonomía nueva.
UPDATE listings l
SET zone_id = z.id
FROM zones z
WHERE l.zone_id IS NULL
  AND z.name IS NOT NULL
  AND (
    unaccent(lower(l.subzone_raw)) = unaccent(lower(z.name))
    OR unaccent(lower(l.zone_raw))  = unaccent(lower(z.name))
  );

-- ── 2) particulares_changes → listing_changes (preserva el histórico) ────────
-- Mapea los tipos legacy a los del esquema nuevo.
INSERT INTO listing_changes (listing_id, change_type, old_value, new_value, changed_at)
SELECT
  l.id,
  CASE c.change_type
    WHEN 'price_change' THEN
      CASE WHEN (c.new_value->>'price')::numeric >= COALESCE((c.old_value->>'price')::numeric, 0)
           THEN 'price_up' ELSE 'price_down' END
    WHEN 'photo_added' THEN 'photo_count_change'
    ELSE c.change_type
  END AS change_type,
  c.old_value,
  c.new_value,
  c.changed_at
FROM particulares_changes c
JOIN particulares p ON p.id = c.particular_id
JOIN listings l     ON l.portal = p.portal AND l.external_id = p.external_id
-- Defensa: solo tipos que el CHECK nuevo acepta tras el mapeo.
WHERE (CASE c.change_type
         WHEN 'price_change' THEN 'price_up'      -- placeholder, validado arriba
         WHEN 'photo_added'  THEN 'photo_count_change'
         ELSE c.change_type END)
      IN ('new_listing','price_up','price_down','reactivated','deleted',
          'phone_added','phone_changed','photo_count_change',
          'floor_plan_added','video_added','description_updated','advertiser_type_changed');

-- ── 3) Sembrar listing_price_history desde los eventos de precio ─────────────
-- Reconstruye una serie básica a partir de los cambios de precio registrados.
INSERT INTO listing_price_history (listing_id, observed_at, price, status)
SELECT
  l.id,
  c.changed_at,
  NULLIF(c.new_value->>'price','')::integer,
  'active'
FROM particulares_changes c
JOIN particulares p ON p.id = c.particular_id
JOIN listings l     ON l.portal = p.portal AND l.external_id = p.external_id
WHERE c.change_type IN ('price_change','price_up','price_down')
  AND (c.new_value->>'price') ~ '^\d+$';

-- Snapshot del precio actual (punto final de la serie).
INSERT INTO listing_price_history (listing_id, observed_at, price, status)
SELECT l.id, COALESCE(l.last_seen_at, now()), l.price,
       CASE WHEN l.is_active THEN 'active' ELSE 'gone' END
FROM listings l
WHERE l.price IS NOT NULL;

COMMIT;

-- ── Verificación rápida (ejecutar tras el COMMIT) ────────────────────────────
-- SELECT count(*) AS listings_importados FROM listings;
-- SELECT count(*) AS cambios_importados  FROM listing_changes;
-- SELECT advertiser_type, count(*) FROM listings GROUP BY 1;
-- SELECT z.name, count(*) FROM listings l LEFT JOIN zones z ON z.id=l.zone_id GROUP BY 1 ORDER BY 2 DESC;
