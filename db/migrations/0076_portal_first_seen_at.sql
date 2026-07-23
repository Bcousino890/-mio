-- ─────────────────────────────────────────────────────────────────────────────
-- 0076 · antigüedad REAL del aviso según el portal (no solo cuándo la vimos)
-- ─────────────────────────────────────────────────────────────────────────────
-- listings_cl.first_seen_at mide cuándo NOSOTROS scrapeamos el anuncio por
-- primera vez — si el discovery recién empezó a cubrir una comuna, un aviso
-- publicado hace meses en el portal aparece con first_seen_at de HOY, y "días
-- en mercado" (hoy calculado como now() - first_seen_at) queda en ~0, aunque el
-- portal declare "Publicado hace 28 días" en la propia ficha (único dato que
-- expone: texto relativo, nunca fecha absoluta — ver parsePostedDaysAgo en
-- parse-portalinmobiliario.mjs).
--
-- portal_first_seen_at = scraped_at - posted_days_ago (aproximación por días,
-- la misma granularidad que declara el portal). property_cl toma el MÍNIMO
-- entre sus listings — el mercado empezó a ver el inmueble desde que la
-- PRIMERA corredora lo publicó, no desde la última.

ALTER TABLE listings_cl
  ADD COLUMN IF NOT EXISTS portal_first_seen_at timestamptz;

ALTER TABLE property_cl
  ADD COLUMN IF NOT EXISTS portal_first_seen_at timestamptz;
