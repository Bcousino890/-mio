-- ─────────────────────────────────────────────────────────────────────────────
-- 0015 · El distrito Salamanca ya no es objetivo directo de scraping
-- ─────────────────────────────────────────────────────────────────────────────
-- La migración 0011 añadió los 6 barrios oficiales del distrito Salamanca como
-- objetivos de scraping, pero dejó is_scrape_target=true en la fila del propio
-- distrito (0002_zones.sql). Scrapear el distrito completo de una sola pasada
-- supera el tope de ~1800 resultados/búsqueda de Idealista y pierde anuncios;
-- ahora que está cubierto por sub-zonas, el distrito pasa a ser solo agregador.

UPDATE zones
SET is_scrape_target = false
WHERE idealista_slug = 'madrid/barrio-de-salamanca';
