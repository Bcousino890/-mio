-- ─────────────────────────────────────────────────────────────────────────────
-- 0007 · Producto: vistas de captación (Lead Flow) y análisis de mercado
-- ─────────────────────────────────────────────────────────────────────────────
-- Vistas en vivo para feeds ligeros; materializadas para agregados pesados
-- (refresco nocturno con pg_cron o desde el backend).

-- ─── Lead Flow: particulares activos (leads de captación) ────────────────────
CREATE OR REPLACE VIEW v_leads_particulares AS
SELECT
  l.id, l.portal, l.external_id, l.source_url,
  l.operation, l.price, l.bedrooms, l.bathrooms, l.square_meters,
  l.contact_name, l.phone, l.phone_confidence,
  l.zone_id, l.zone_raw, l.address, l.latitude, l.longitude,
  l.rc14, l.rc20,
  l.detected_at, l.first_seen_at, l.last_seen_at
FROM listings l
WHERE l.advertiser_type = 'particular'
  AND l.is_active = true;

-- ─── Exclusivas rotas: mismo inmueble (RC20) en ≥2 agencias distintas ────────
-- Oportunidad de captación: si varias agencias lo anuncian, no hay exclusiva.
-- Requiere resolución RC (rc20). Vacía hasta que el motor RC esté en marcha.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_broken_exclusives AS
SELECT
  l.rc20,
  count(DISTINCT l.advertiser_name)               AS agency_count,
  array_agg(DISTINCT l.advertiser_name)           AS agencies,
  min(l.price)                                    AS min_price,
  max(l.price)                                    AS max_price,
  array_agg(DISTINCT l.portal)                    AS portals,
  max(l.last_seen_at)                             AS last_seen_at
FROM listings l
WHERE l.advertiser_type = 'professional'
  AND l.is_active = true
  AND l.rc20 IS NOT NULL
  AND l.advertiser_name IS NOT NULL
GROUP BY l.rc20
HAVING count(DISTINCT l.advertiser_name) >= 2;

CREATE UNIQUE INDEX IF NOT EXISTS uq_broken_exclusives_rc20 ON mv_broken_exclusives(rc20);

-- ─── Análisis de mercado por zona ────────────────────────────────────────────
-- €/m² mediano, stock activo, time-on-market mediano, por zona y operación.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_market_area AS
SELECT
  l.zone_id,
  z.name                                                       AS zone_name,
  z.level                                                      AS zone_level,
  l.operation,
  count(*) FILTER (WHERE l.is_active)                          AS active_count,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY l.price)
    FILTER (WHERE l.is_active)                                 AS median_price,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY (l.price::numeric / NULLIF(l.square_meters,0)))
    FILTER (WHERE l.is_active AND l.square_meters > 0)         AS median_price_sqm,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (now() - l.first_seen_at))/86400.0)
    FILTER (WHERE l.is_active)                                 AS median_days_on_market,
  count(*) FILTER (WHERE l.advertiser_type = 'particular' AND l.is_active) AS particular_count,
  now()                                                        AS computed_at
FROM listings l
LEFT JOIN zones z ON z.id = l.zone_id
WHERE l.operation IS NOT NULL
GROUP BY l.zone_id, z.name, z.level, l.operation;

CREATE UNIQUE INDEX IF NOT EXISTS uq_market_area ON mv_market_area(zone_id, operation);

-- Refresco (concurrente requiere los índices únicos de arriba):
--   REFRESH MATERIALIZED VIEW CONCURRENTLY mv_broken_exclusives;
--   REFRESH MATERIALIZED VIEW CONCURRENTLY mv_market_area;
