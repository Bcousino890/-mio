-- Añadir columnas read_at y receiver_id a team_direct_messages
-- read_at: marca cuándo el destinatario leyó el mensaje
-- receiver_id: referencia directa al destinatario (redundante pero útil para índices/políticas)

ALTER TABLE team_direct_messages
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

ALTER TABLE team_direct_messages
  ADD COLUMN IF NOT EXISTS receiver_id uuid REFERENCES profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tdm_receiver_read
  ON team_direct_messages(receiver_id, read_at)
  WHERE read_at IS NULL;
