-- ─────────────────────────────────────────────────────────────────────────────
-- 0009 · Referencia Catastral BAJO DEMANDA ("¿quieres la dirección exacta?")
-- ─────────────────────────────────────────────────────────────────────────────
-- La RC NO se resuelve en masa: se pide POR ANUNCIO cuando el usuario lo pide.
-- Dos niveles:
--   rc14 = edificio/finca → DIRECCIÓN EXACTA (calle y número).
--   rc20 = vivienda concreta dentro del edificio (planta/puerta).
-- El resultado se cachea en la fila (listings.rc14/rc20/rc_status) y aquí queda
-- el registro de la petición (auditoría + ambigüedades).

CREATE TABLE IF NOT EXISTS rc_resolution_request (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      uuid REFERENCES listings(id) ON DELETE CASCADE,
  property_id     uuid REFERENCES property(id) ON DELETE CASCADE,
  level_requested text NOT NULL CHECK (level_requested IN ('rc14','rc20')),
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','resolved','ambiguous','failed')),
  rc14            char(14),
  rc20            char(20),
  confidence      numeric,
  exact_address   text,
  candidates      jsonb,          -- candidatos cuando hay ambigüedad (varios pisos iguales)
  requested_by    text,           -- usuario que pidió la dirección exacta
  requested_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_rc_req_listing ON rc_resolution_request(listing_id);
CREATE INDEX IF NOT EXISTS idx_rc_req_status  ON rc_resolution_request(status);
