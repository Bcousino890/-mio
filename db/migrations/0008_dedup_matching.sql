-- ─────────────────────────────────────────────────────────────────────────────
-- 0008 · Deduplicación por MATCHING de anuncios duplicados (sin catastro, sin IA)
-- ─────────────────────────────────────────────────────────────────────────────
-- Objetivo: detectar que el anuncio A (Idealista) y el B (Fotocasa) son el MISMO
-- piso, y agruparlos bajo una misma `property`. NO usa RC; usa señales del
-- propio anuncio.
--
-- ALGORITMO (lógica en lib/, datos aquí):
--   1) BLOCKING: candidatos = mismos operation + nº habitaciones + m² (±~8%)
--      y cercanía geográfica (ST_DWithin, ~150 m por el círculo difuso).
--   2) SCORING por par (0..1), suma ponderada de señales:
--        - distancia geográfica (más cerca = mejor)
--        - diferencia de m² y de habitaciones/baños
--        - similitud de precio
--        - distancia de phash entre fotos (Hamming; fotos iguales = duplicado fuerte)
--        - similitud de texto de la descripción (pg_trgm / similarity)
--        - mismo property_type
--   3) Si score ≥ umbral → confirmar y unir al mismo property (transitivo).
--      Pares 0.55–umbral → 'candidate' para revisión.

CREATE TABLE IF NOT EXISTS listing_match (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_a   uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  listing_b   uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  score       numeric NOT NULL,                 -- 0..1
  signals     jsonb,                            -- {geo_m, sqm_diff_pct, phash_dist, text_sim, price_diff_pct, ...}
  status      text NOT NULL DEFAULT 'candidate'
                CHECK (status IN ('candidate','confirmed','rejected')),
  decided_by  text NOT NULL DEFAULT 'auto'      -- 'auto' | 'human'
                CHECK (decided_by IN ('auto','human')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz,
  CHECK (listing_a <> listing_b),
  UNIQUE (listing_a, listing_b)                 -- la app inserta el par ordenado (a<b)
);

CREATE INDEX IF NOT EXISTS idx_match_a      ON listing_match(listing_a);
CREATE INDEX IF NOT EXISTS idx_match_b      ON listing_match(listing_b);
CREATE INDEX IF NOT EXISTS idx_match_status ON listing_match(status);
CREATE INDEX IF NOT EXISTS idx_match_score  ON listing_match(score DESC);

-- ─── Generador de candidatos (blocking) — eficiente en DB ────────────────────
-- Devuelve anuncios activos compatibles con `p_listing` dentro del radio dado.
-- El scoring fino (phash, texto) se calcula luego en la app sobre estos pocos.
CREATE OR REPLACE FUNCTION find_match_candidates(
  p_listing  uuid,
  p_radius_m integer DEFAULT 150,
  p_sqm_pct  numeric DEFAULT 0.08
)
RETURNS TABLE (candidate_id uuid, dist_m double precision, text_sim real)
LANGUAGE sql STABLE AS $$
  SELECT
    c.id,
    ST_Distance(l.geom::geography, c.geom::geography) AS dist_m,
    similarity(coalesce(l.description,''), coalesce(c.description,'')) AS text_sim
  FROM listings l
  JOIN listings c
    ON c.id <> l.id
   AND c.is_active
   AND c.operation IS NOT DISTINCT FROM l.operation
   AND coalesce(c.bedrooms,-1) = coalesce(l.bedrooms,-1)
   AND (l.square_meters IS NULL OR c.square_meters IS NULL
        OR abs(c.square_meters - l.square_meters) <= ceil(l.square_meters * p_sqm_pct))
   AND l.geom IS NOT NULL AND c.geom IS NOT NULL
   AND ST_DWithin(l.geom::geography, c.geom::geography, p_radius_m)
  WHERE l.id = p_listing;
$$;
