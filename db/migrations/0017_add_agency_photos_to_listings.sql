-- ─────────────────────────────────────────────────────────────────────────────
-- 0017 · Agregar fotos de CRM a listings y soporte multi-fuente
-- ─────────────────────────────────────────────────────────────────────────────
-- Añadimos columnas para guardar fotos extraídas de las webs de las agencias
-- (CRM: Mobilia, Inmoweb, Level, etc.). Las fotos de Idealista seguirán en la
-- columna `photos` (JSONB array). Las fotos de CRM van en `agency_photos`.
--
-- Estructura:
--   - photos: JSONB array de URLs de Idealista (existente, no cambia)
--   - agency_photos: JSONB array de URLs extraídas del CRM de la agencia
--   - photos_by_source: JSONB {source_key: [...URLs...]} (consolidado, opcional)
--   - photo_source_status: 'idealista_only' | 'agency_only' | 'both' | 'failed'
--   - agency_photo_count: denormalizado para queries rápidas
--   - agency_photos_fetched_at: cuándo fue último intento
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS agency_photos jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS photos_by_source jsonb,
  ADD COLUMN IF NOT EXISTS photo_source_status text DEFAULT 'idealista_only'
    CHECK (photo_source_status IN ('idealista_only', 'agency_only', 'both', 'failed', 'unknown')),
  ADD COLUMN IF NOT EXISTS agency_photo_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agency_photos_fetched_at timestamptz;

-- Índices para queries eficientes
CREATE INDEX IF NOT EXISTS idx_listings_agency_photo_count
  ON listings(agency_photo_count) WHERE agency_photo_count > 0;

CREATE INDEX IF NOT EXISTS idx_listings_photo_source_status
  ON listings(photo_source_status);

CREATE INDEX IF NOT EXISTS idx_listings_needs_crm_photos
  ON listings(agency_domain, agency_reference_id, agency_crm)
  WHERE agency_photos IS NULL AND agency_crm IS NOT NULL;

-- Índice para tracking de intentos de scraping recientes
CREATE INDEX IF NOT EXISTS idx_listings_agency_photos_fetched
  ON listings(agency_photos_fetched_at DESC) WHERE agency_crm IS NOT NULL;

-- Comentarios para documentación
COMMENT ON COLUMN listings.agency_photos IS
  'Array JSONB de URLs de fotos extraídas del CRM de la agencia (Mobilia, Inmoweb, etc.)';
COMMENT ON COLUMN listings.photos_by_source IS
  'JSONB consolidado: {''idealista'': [...], ''mobilia'': [...], ...} (opcional, futuro)';
COMMENT ON COLUMN listings.photo_source_status IS
  'Estado de disponibilidad de fotos: idealista_only | agency_only | both | failed | unknown';
COMMENT ON COLUMN listings.agency_photo_count IS
  'Denormalizado: array_length(agency_photos, 1) para queries rápidas sin descomponer JSONB';
COMMENT ON COLUMN listings.agency_photos_fetched_at IS
  'Timestamp del último intento de scraping de fotos de CRM (exitoso o fallido)';
