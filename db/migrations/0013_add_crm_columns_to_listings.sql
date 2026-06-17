-- ─────────────────────────────────────────────────────────────────────────────
-- 0013 · Agregar columnas de CRM detectado a listings
-- ─────────────────────────────────────────────────────────────────────────────
-- Agregamos columnas para guardar el CRM detectado en cada anuncio:
--   - agency_url: URL del "enlace adicional" (típicamente hacia web de agencia)
--   - agency_crm: CRM detectado (MOBILIA, INMOWEB, etc.)
--   - agency_reference_id: ID del anuncio en el CRM de la agencia
--   - agency_domain: dominio de la agencia (extraído de agency_url)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS agency_url text,
  ADD COLUMN IF NOT EXISTS agency_crm text
    CHECK (agency_crm IS NULL OR agency_crm IN ('MOBILIA','INMOWEB','LEVEL','FOTOCASA','IDEALISTA','VIVANUNCIOS','UNKNOWN')),
  ADD COLUMN IF NOT EXISTS agency_reference_id text,
  ADD COLUMN IF NOT EXISTS agency_domain text;

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_listings_agency_domain
  ON listings(agency_domain) WHERE agency_domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_agency_crm
  ON listings(agency_crm) WHERE agency_crm IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_agency_ref
  ON listings(agency_domain, agency_reference_id) WHERE agency_domain IS NOT NULL AND agency_reference_id IS NOT NULL;
