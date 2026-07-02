-- ─────────────────────────────────────────────────────────────────────────────
-- 0047 · captaciones_cl — pipeline de captación end-to-end Chile
-- ─────────────────────────────────────────────────────────────────────────────
-- Una fila por propiedad captada desde una URL de Portal Inmobiliario. Persiste
-- el resultado de cada etapa del pipeline para que sea reanudable y auditable:
--
--   1. extracted      → datos del anuncio extraídos (snapshot + listings_cl)
--   2. matched        → rol SII + dirección exacta resueltos (el "RC20 chileno")
--   3. owner_found    → nombre del dueño confirmado vía certificado TGR
--   4. contact_found  → RUT + teléfonos del dueño vía DealerNet
--
-- El match de rol solo se auto-confirma con probabilidad ≥0.92 y ventaja clara
-- sobre el segundo candidato; si además la dirección del certificado TGR
-- coincide con la dirección SII del rol elegido, match_verified=true
-- (confirmación documental). Todo lo demás queda en needs_review para
-- selección manual — nunca se inventa un dueño con un match dudoso.

CREATE TABLE IF NOT EXISTS captaciones_cl (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url              text NOT NULL UNIQUE,
  listing_cl_id           uuid REFERENCES listings_cl(id) ON DELETE SET NULL,

  -- ── Etapa 1: snapshot del anuncio ──────────────────────────────────────────
  title                   text,
  operation               text CHECK (operation IN ('sale','rent')),
  property_type           text,
  price_raw               numeric,
  currency                text,
  sqm                     integer,
  bedrooms                integer,
  bathrooms               integer,
  address                 text,
  comuna_label            text,
  sii_comuna_code         text,
  latitude                numeric,
  longitude               numeric,
  photos                  jsonb,
  raw_extracted           jsonb,                    -- payload completo del parser

  -- ── Etapa 2: match rol SII (dirección exacta) ──────────────────────────────
  sii_rol                 text,                     -- "manzana-predio", ej. "795-198"
  sii_direccion           text,                     -- dirección exacta según catastro SII
  match_score             numeric,                  -- probabilidad 0..1 calibrada
  match_confidence        text CHECK (match_confidence IN ('confirmed','high','candidate','manual','none')),
  match_verified          boolean NOT NULL DEFAULT false,  -- true = dirección TGR coincide (documental)
  match_method            text,                     -- 'auto' | 'manual'
  match_signals           jsonb,                    -- desglose por señal (auditable)
  candidates              jsonb,                    -- top candidatos para revisión manual

  -- ── Etapa 3: dueño vía TGR ─────────────────────────────────────────────────
  tgr_status              text NOT NULL DEFAULT 'pending'
                            CHECK (tgr_status IN ('pending','ok','sin_deuda','cooldown','error','skipped')),
  owner_name              text,
  tgr_direccion           text,
  tgr_consulted_at        timestamptz,
  tgr_error               text,

  -- ── Etapa 4: contacto vía DealerNet ────────────────────────────────────────
  dealernet_status        text NOT NULL DEFAULT 'pending'
                            CHECK (dealernet_status IN ('pending','ok','ambiguous','not_found','error','skipped')),
  owner_rut               text,                     -- "12345678-9"
  owner_rut_candidates    jsonb,                    -- candidatos DealerNet si ambiguo
  phones                  jsonb,                    -- [{numero, tipo, whatsapp, fuente, calidad}]
  emails                  jsonb,
  dealernet_consulted_at  timestamptz,
  dealernet_error         text,

  -- ── Estado del pipeline ────────────────────────────────────────────────────
  stage                   text NOT NULL DEFAULT 'extracted'
                            CHECK (stage IN ('extracted','matched','owner_found','contact_found')),
  needs_review            boolean NOT NULL DEFAULT false,
  review_reason           text,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_captaciones_cl_stage   ON captaciones_cl(stage);
CREATE INDEX IF NOT EXISTS idx_captaciones_cl_review  ON captaciones_cl(needs_review) WHERE needs_review;
CREATE INDEX IF NOT EXISTS idx_captaciones_cl_comuna  ON captaciones_cl(sii_comuna_code);
CREATE INDEX IF NOT EXISTS idx_captaciones_cl_rol     ON captaciones_cl(sii_rol) WHERE sii_rol IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_captaciones_cl_created ON captaciones_cl(created_at DESC);
