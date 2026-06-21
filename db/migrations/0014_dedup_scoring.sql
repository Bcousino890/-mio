-- ─────────────────────────────────────────────────────────────────────────────
-- 0014 · Deduplicación: scoring multi-señal y optimizaciones de indexación
-- ─────────────────────────────────────────────────────────────────────────────
-- Añade:
--   1) Índice parcial para la cola de trabajo (matched_at IS NULL)
--   2) Índice compuesto GiST (geom, bedrooms) para colapsar blocking en un scan
--   3) Función SQL para calcular señales atómicas (distancia, phash, texto, etc.)
--   4) Tabla de estado para gestionar jobs de dedup

-- ─── Índice parcial para cola de trabajo ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_match_candidates_pending
  ON listing_match(score DESC)
  WHERE status = 'candidate' AND decided_at IS NULL;

-- ─── Índice compuesto GiST (geom + bedrooms) ───────────────────────────────
-- Requiere extensión btree_gist; si no existe, ignora con DO block
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  -- Ahora crear el índice compuesto
  CREATE INDEX IF NOT EXISTS idx_listings_geom_bedrooms
    ON listings USING gist(geom, bedrooms)
    WHERE is_active;
EXCEPTION
  WHEN OTHERS THEN NULL;  -- ignorar si btree_gist no está disponible
END $$;

-- ─── Función auxiliar: Hamming distance (XOR nativo + popcount) ─────────────
-- Como los pHash se guardan como texto (hex), convertimos a bits y hacemos XOR.
-- Definida ANTES de calculate_match_signals porque esa función es
-- `LANGUAGE sql STABLE` — Postgres valida su cuerpo (incluida la resolución
-- de funciones que llama) en el momento del CREATE, no al invocarla; si
-- hamming_distance no existe todavía, el CREATE FUNCTION de abajo falla.
CREATE OR REPLACE FUNCTION hamming_distance(
  phash_a text,
  phash_b text
)
RETURNS integer
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_a bigint;
  v_b bigint;
  v_xor bigint;
  v_count integer := 0;
BEGIN
  -- Si alguno es NULL o no son válidos, retornar NULL
  IF phash_a IS NULL OR phash_b IS NULL OR length(phash_a) <> length(phash_b) THEN
    RETURN NULL;
  END IF;

  -- Convertir hex strings a bigint (máx 64 bits para pHash)
  BEGIN
    v_a := ('x' || phash_a)::bit(64)::bigint;
    v_b := ('x' || phash_b)::bit(64)::bigint;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  -- XOR y contar bits (popcount)
  v_xor := v_a # v_b;
  WHILE v_xor > 0 LOOP
    v_count := v_count + (v_xor & 1)::int;
    v_xor := v_xor >> 1;
  END LOOP;

  RETURN v_count;
END $$;

-- ─── Función para calcular señales atómicas de similitud ─────────────────────
-- Calcula todas las señales que luego Node.js combinará con pesos.
-- Devuelve jsonb con todas las señales crudas.
CREATE OR REPLACE FUNCTION calculate_match_signals(
  p_listing_a uuid,
  p_listing_b uuid
)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH pair AS (
    SELECT
      a.id a_id, b.id b_id,
      a.geom a_geom, b.geom b_geom,
      a.square_meters a_sqm, b.square_meters b_sqm,
      a.bedrooms a_beds, b.bedrooms b_beds,
      a.bathrooms a_baths, b.bathrooms b_baths,
      a.price a_price, b.price b_price,
      a.description a_desc, b.description b_desc,
      a.cover_phash a_phash, b.cover_phash b_phash,
      a.property_type a_type, b.property_type b_type,
      a.operation a_op, b.operation b_op
    FROM listings a, listings b
    WHERE a.id = p_listing_a AND b.id = p_listing_b
  )
  SELECT jsonb_build_object(
    'distance_m', CASE WHEN p.a_geom IS NOT NULL AND p.b_geom IS NOT NULL
                       THEN ROUND(ST_Distance(p.a_geom::geography, p.b_geom::geography)::numeric, 2)
                       ELSE NULL END,
    'sqm_diff_pct', CASE WHEN p.a_sqm IS NOT NULL AND p.b_sqm IS NOT NULL AND p.a_sqm > 0
                         THEN ROUND(ABS(p.a_sqm - p.b_sqm) * 100.0 / p.a_sqm, 2)
                         ELSE NULL END,
    'bedrooms_same', COALESCE(p.a_beds = p.b_beds, FALSE),
    'bathrooms_diff', CASE WHEN p.a_baths IS NOT NULL AND p.b_baths IS NOT NULL
                           THEN ABS(p.a_baths - p.b_baths)
                           ELSE NULL END,
    'price_diff_pct', CASE WHEN p.a_price IS NOT NULL AND p.b_price IS NOT NULL AND p.a_price > 0
                           THEN ROUND(ABS(p.a_price - p.b_price) * 100.0 / p.a_price, 2)
                           ELSE NULL END,
    'text_similarity', ROUND(similarity(COALESCE(p.a_desc, ''), COALESCE(p.b_desc, ''))::numeric, 4),
    'phash_distance', CASE WHEN p.a_phash IS NOT NULL AND p.b_phash IS NOT NULL
                           THEN hamming_distance(p.a_phash, p.b_phash)
                           ELSE NULL END,
    'property_type_same', COALESCE(p.a_type = p.b_type, FALSE),
    'operation_same', COALESCE(p.a_op = p.b_op, FALSE)
  ) FROM pair p;
$$;

-- ─── Tabla para gestionar el estado del job de deduplicación ────────────────
CREATE TABLE IF NOT EXISTS dedup_job_state (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name          text NOT NULL,
  last_run_at       timestamptz,
  next_run_at       timestamptz,
  candidates_found  integer DEFAULT 0,
  candidates_matched integer DEFAULT 0,
  status            text NOT NULL DEFAULT 'idle'
                    CHECK (status IN ('idle','running','paused','failed')),
  last_error        text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_name)
);

CREATE INDEX IF NOT EXISTS idx_dedup_job_status ON dedup_job_state(status);
