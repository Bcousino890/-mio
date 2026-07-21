-- ─────────────────────────────────────────────────────────────────────────────
-- 0065 · corredoras_cl: entidad corredora consolidada (plan Anuncios CL · H4)
-- ─────────────────────────────────────────────────────────────────────────────
-- Hoy la corredora vive solo como texto libre en listings_cl.advertiser_name /
-- phone — no hay una entidad que consolide su identidad entre republicaciones ni
-- que acumule métricas. Esta tabla la crea.
--
-- CLAVE DE IDENTIDAD: `advertiser_id` (el seller_id de Mercado Libre), NO el
-- nombre. El nombre comercial se escribe de mil formas y cambia; el seller_id es
-- estable y único por corredora en ML (ver terna de identificadores, §2.1 del
-- plan / H9). El nombre normalizado se guarda solo para mostrar y para el
-- fallback de matching cuando una fuente no trae seller_id (webs propias).
--
-- Métricas derivadas (stock activo, rotación, exclusividad, comunas de
-- operación): se guardan denormalizadas aquí y las refresca el job
-- `broker-enrich:<advertiser_id>` (H2), no se recalculan en cada consulta. El
-- plan las describe como "vista materializada o job"; se opta por columnas +
-- job para poder mostrarlas en la ficha /chile/corredoras/[id] sin un JOIN
-- pesado por request.

CREATE TABLE IF NOT EXISTS corredoras_cl (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identidad estable en Mercado Libre. UNIQUE: una corredora = una fila.
  -- Puede ser NULL transitoriamente para corredoras descubiertas SOLO por su web
  -- propia (aún sin cruzar con su seller_id de PI) — por eso el UNIQUE es
  -- parcial (WHERE advertiser_id IS NOT NULL), no una constraint de columna.
  advertiser_id        text,

  -- Nombre normalizado (para mostrar y para el fallback de matching web-propia
  -- ↔ PI cuando no hay seller_id). name_raw guarda la última variante cruda vista.
  name_normalized      text,
  name_raw             text,
  phones               text[] NOT NULL DEFAULT '{}',   -- teléfonos vistos, deduplicados

  -- ── Web propia + plataforma CRM (H4 / H21) ────────────────────────────────
  -- Habilita el crawl de la web propia y el enlace determinista por código
  -- interno (seller_reference). crm_platform lo fija el detector
  -- detect-corredora-crm-cl.mjs: convecta | ofinet | other | unknown.
  web_propia_url       text,
  crm_platform         text NOT NULL DEFAULT 'unknown'
                         CHECK (crm_platform IN ('convecta','ofinet','other','unknown')),

  -- ── Métricas derivadas (refrescadas por broker-enrich) ────────────────────
  active_listings_count  integer NOT NULL DEFAULT 0,   -- stock activo hoy en listings_cl
  total_listings_seen    integer NOT NULL DEFAULT 0,   -- histórico de anuncios distintos vistos
  comunas_operated       text[] NOT NULL DEFAULT '{}', -- nombres de comunas donde tiene stock
  avg_days_on_market     numeric,                      -- velocidad de rotación (días promedio hasta delisted)
  exclusivity_ratio      numeric,                      -- % de sus inmuebles que solo publica ella (property_cl con corredora_count = 1)
  metrics_updated_at     timestamptz,                  -- última corrida de broker-enrich

  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Una corredora por seller_id (índice único parcial: permite filas sin
-- advertiser_id para corredoras descubiertas solo por web propia).
CREATE UNIQUE INDEX IF NOT EXISTS uq_corredoras_cl_advertiser
  ON corredoras_cl(advertiser_id) WHERE advertiser_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_corredoras_cl_crm
  ON corredoras_cl(crm_platform) WHERE crm_platform <> 'unknown';
CREATE INDEX IF NOT EXISTS idx_corredoras_cl_name_trgm
  ON corredoras_cl USING gin(name_normalized gin_trgm_ops);

-- ─── Vínculo listings_cl → corredoras_cl ────────────────────────────────────
-- El anuncio apunta a su corredora consolidada. NULL hasta que broker-enrich la
-- resuelve/crea a partir del advertiser_id del anuncio.
ALTER TABLE listings_cl
  ADD COLUMN IF NOT EXISTS corredora_id uuid REFERENCES corredoras_cl(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_listings_cl_corredora
  ON listings_cl(corredora_id);
-- Cola de broker-enrich: anuncios activos con advertiser_id pero aún sin
-- corredora consolidada.
CREATE INDEX IF NOT EXISTS idx_listings_cl_unlinked_corredora
  ON listings_cl(advertiser_id) WHERE is_active AND corredora_id IS NULL AND advertiser_id IS NOT NULL;
