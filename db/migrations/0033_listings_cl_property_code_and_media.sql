-- ─────────────────────────────────────────────────────────────────────────────
-- 0033 · listings_cl: agregar property_code (referencia canónica), seller_id,
--       seller_reference, y columnas para persistencia de media
-- ─────────────────────────────────────────────────────────────────────────────
-- Nuevos campos para detectar re-publicaciones (plan V2, Fase 1):
--   - property_code: ID único de la propiedad en el blob de Mercado Libre,
--     persiste cuando se relista con nuevo MLC-ID (a los 45 días en arriendos)
--   - advertiser_id: seller_id de Mercado Libre (ID único de la agencia)
--   - seller_reference: referencia interna de la corredora en su CRM
--
-- Nuevos campos para persistencia de fotos/video (plan V2, Fase 2):
--   - stored_photos: JSONB array de {original_url, bucket_url, phash}
--   - stored_video: URL del video en bucket (si existe)
--   - media_synced_at: timestamp de cuándo se sincronizaron a storage los archivos

ALTER TABLE listings_cl
  -- Referencia canónica de la propiedad (Plan V2: detectar re-publicaciones)
  ADD COLUMN IF NOT EXISTS property_code text,           -- ej. "5495"
  ADD COLUMN IF NOT EXISTS advertiser_id text,            -- seller_id de Mercado Libre
  ADD COLUMN IF NOT EXISTS seller_reference text,         -- referencia interna corredora

  -- Persistencia de media (Plan V2: guardar fotos/video del CDN, no solo URLs)
  ADD COLUMN IF NOT EXISTS stored_photos jsonb,           -- [{original_url, bucket_url, phash}, ...]
  ADD COLUMN IF NOT EXISTS stored_video text,             -- URL del video en bucket
  ADD COLUMN IF NOT EXISTS media_synced_at timestamptz;   -- cuándo se sincronizaron

-- Índices para deduplicación por property_code + advertiser_id
CREATE INDEX IF NOT EXISTS idx_listings_cl_property_code
  ON listings_cl(property_code)
  WHERE property_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_listings_cl_property_seller
  ON listings_cl(property_code, advertiser_id)
  WHERE property_code IS NOT NULL AND advertiser_id IS NOT NULL;
