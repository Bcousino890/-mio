-- Registra cuándo se detectó que el anuncio fue retirado del portal.
-- Se rellena al marcar is_active = false y se borra si el anuncio vuelve.
ALTER TABLE particulares
  ADD COLUMN IF NOT EXISTS taken_down_at TIMESTAMP;

-- Índice para consultar histórico de bajas rápidamente.
CREATE INDEX IF NOT EXISTS idx_particulares_taken_down ON particulares(taken_down_at)
  WHERE taken_down_at IS NOT NULL;
