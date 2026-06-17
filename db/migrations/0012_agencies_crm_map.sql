-- ─────────────────────────────────────────────────────────────────────────────
-- 0012 · Mapeo de agencias a CRM (detección automática)
-- ─────────────────────────────────────────────────────────────────────────────
-- Tabla para registrar qué CRM utiliza cada agencia basándose en los patrones
-- detectados en sus URLs. Permite:
--   1. Aprender qué CRM usa cada dominio
--   2. Detectar cambios (si una agencia cambió de CRM)
--   3. Optimizar scrapers específicos por CRM
--   4. Estadísticas de adopción de CRM por agencia
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agencies_crm_map (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identidad de la agencia
  agency_domain         text NOT NULL UNIQUE,  -- p.ej. "housingo.es", "remax-centro.es"
  agency_name           text,                   -- nombre de la agencia (opcional, para UI)

  -- CRM detectado
  crm_type              text NOT NULL          -- MOBILIA, INMOWEB, LEVEL, FOTOCASA, IDEALISTA, VIVANUNCIOS, UNKNOWN
                          CHECK (crm_type IN ('MOBILIA','INMOWEB','LEVEL','FOTOCASA','IDEALISTA','VIVANUNCIOS','UNKNOWN')),

  -- Evidencia / confianza
  detection_samples     integer NOT NULL DEFAULT 1,  -- número de anuncios analizados para confirmar este CRM
  sample_url            text,                  -- ejemplo de URL que mostró el patrón
  first_detected_at     timestamptz NOT NULL DEFAULT now(),
  last_detected_at      timestamptz NOT NULL DEFAULT now(),

  -- Metadatos
  is_professional       boolean,               -- ¿es agencia profesional o particular?
  listing_count         integer DEFAULT 0,    -- número de anuncios de esta agencia en nuestra BD

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agencies_crm_type
  ON agencies_crm_map(crm_type);
CREATE INDEX IF NOT EXISTS idx_agencies_crm_last_detected
  ON agencies_crm_map(last_detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_agencies_crm_domain
  ON agencies_crm_map(agency_domain);
