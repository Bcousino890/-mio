-- ─────────────────────────────────────────────────────────────────────────────
-- 0034 · listing_version_log_cl: registro de cambios entre corridas del scraper
-- ─────────────────────────────────────────────────────────────────────────────
-- Permite detectar qué cambió en cada anuncio de una corrida a la siguiente:
--   - Nuevo anuncio (NEW)
--   - Cambio de precio (PRICE_CHANGE)
--   - Actualización de descripción/fotos (UPDATED)
--   - Delisting (DELISTED)
--   - Re-publicación tras borrado (REACTIVATED)
--   - Cambio de agencia (AGENCY_CHANGE)
--
-- Poblada por `scraper-portal-inmobiliario-rm.mjs` al hacer upsert en listings_cl

CREATE TABLE IF NOT EXISTS listing_version_log_cl (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id                uuid NOT NULL REFERENCES listings_cl(id) ON DELETE CASCADE,
  scraped_at                timestamptz NOT NULL,

  -- Tipo de cambio detectado
  change_type               text NOT NULL
                              CHECK (change_type IN ('new', 'price_change', 'updated', 'delisted', 'reactivated', 'agency_change', 'misc')),

  -- Deltas (NULL = no aplicable o sin cambio)
  price_before              integer,
  price_after               integer,
  photos_count_before       integer,
  photos_count_after        integer,
  agency_before             text,
  agency_after              text,

  -- Metadata
  created_at                timestamptz NOT NULL DEFAULT now(),

  -- Índice para queries de "qué cambió en la última corrida"
  UNIQUE (listing_id, scraped_at)
);

CREATE INDEX IF NOT EXISTS idx_version_log_cl_listing
  ON listing_version_log_cl(listing_id, scraped_at DESC);

CREATE INDEX IF NOT EXISTS idx_version_log_cl_change_type
  ON listing_version_log_cl(change_type, scraped_at DESC);

CREATE INDEX IF NOT EXISTS idx_version_log_cl_scraped_at
  ON listing_version_log_cl(scraped_at DESC);
