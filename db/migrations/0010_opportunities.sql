-- ─────────────────────────────────────────────────────────────────────────────
-- 0010 · Oportunidades de inversión
-- ─────────────────────────────────────────────────────────────────────────────
-- Detecta anuncios "baratos" frente a su zona: precio/m² muy por debajo de la
-- mediana del barrio/distrito (mv_market_area), con señales de motivación de
-- venta (bajadas de precio, mucho tiempo en mercado, particular sin comisión).
-- Parametrizable: aquí umbral por defecto = 15% bajo la mediana de la zona.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_opportunities AS
SELECT
  l.id                                                       AS listing_id,
  l.property_id,
  l.portal,
  l.source_url,
  l.operation,
  l.price,
  l.square_meters,
  round((l.price::numeric / NULLIF(l.square_meters,0)), 0)   AS price_sqm,
  round(m.median_price_sqm, 0)                              AS zone_median_sqm,
  -- % por debajo de la mediana de la zona (0.20 = 20% más barato)
  round(1 - (l.price::numeric / NULLIF(l.square_meters,0)) / NULLIF(m.median_price_sqm,0), 3)
                                                            AS discount_ratio,
  l.advertiser_type,
  l.zone_id,
  z.name                                                    AS zone_name,
  z.level                                                   AS zone_level,
  l.bedrooms,
  l.bathrooms,
  l.first_seen_at,
  round(EXTRACT(EPOCH FROM (now() - l.first_seen_at))/86400.0, 0) AS days_on_market,
  (SELECT count(*) FROM listing_changes c
     WHERE c.listing_id = l.id AND c.change_type = 'price_down')  AS price_drops,
  l.latitude, l.longitude,
  now()                                                     AS computed_at
FROM listings l
JOIN zones z          ON z.id = l.zone_id
JOIN mv_market_area m ON m.zone_id = l.zone_id AND m.operation = l.operation
WHERE l.is_active
  AND l.price > 0
  AND l.square_meters > 0
  AND m.median_price_sqm > 0
  -- al menos 15% por debajo de la mediana €/m² de su zona
  AND (l.price::numeric / l.square_meters) < m.median_price_sqm * 0.85;

CREATE UNIQUE INDEX IF NOT EXISTS uq_opportunities_listing ON mv_opportunities(listing_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_discount ON mv_opportunities(discount_ratio DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_zone     ON mv_opportunities(zone_id);

-- Refresco (tras mv_market_area):
--   REFRESH MATERIALIZED VIEW CONCURRENTLY mv_opportunities;
