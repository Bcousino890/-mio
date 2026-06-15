-- ─────────────────────────────────────────────────────────────────────────────
-- 0005 · Histórico de precio + log de cambios (tracking subidas/bajadas)
-- ─────────────────────────────────────────────────────────────────────────────
-- Dos mecanismos complementarios:
--   listing_price_history : SERIE temporal append-only (snapshot por scrape).
--                           Alimenta analítica: mediana €/m² en el tiempo, TOM.
--   listing_changes       : EVENTOS discretos (subió/bajó precio, baja, etc.).
--                           Para Lead Flow y feed de actividad.
-- (Equivale a particulares_changes de smartbc, ampliado y para todo listing.)

CREATE TABLE IF NOT EXISTS listing_price_history (
  id          bigserial PRIMARY KEY,
  listing_id  uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL DEFAULT now(),
  price       integer,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','gone'))
);

CREATE INDEX IF NOT EXISTS idx_price_history_listing ON listing_price_history(listing_id, observed_at DESC);
-- BRIN: la tabla crece mucho y se consulta por rango temporal; índice barato.
CREATE INDEX IF NOT EXISTS idx_price_history_observed ON listing_price_history USING brin(observed_at);

CREATE TABLE IF NOT EXISTS listing_changes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  change_type text NOT NULL CHECK (change_type IN (
    'new_listing',
    'price_up',
    'price_down',
    'reactivated',
    'deleted',
    'phone_added',
    'phone_changed',
    'photo_count_change',
    'floor_plan_added',
    'video_added',
    'description_updated',
    'advertiser_type_changed'
  )),
  old_value   jsonb,
  new_value   jsonb,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_changes_listing ON listing_changes(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_changes_type    ON listing_changes(change_type);
CREATE INDEX IF NOT EXISTS idx_listing_changes_at      ON listing_changes(changed_at DESC);

ALTER TABLE listing_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_changes       ENABLE ROW LEVEL SECURITY;
