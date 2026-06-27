-- ─────────────────────────────────────────────────────────────────────────────
-- 0046 · Marcado de revisión manual para certificados TGR con error o sin nombre
-- ─────────────────────────────────────────────────────────────────────────────
-- Permite marcar como "revisado" los roles que el scraper dejó con estado de
-- error o sin nombre de contribuyente, para hacer seguimiento manual sin que
-- se pierdan al recargar el dashboard /chile/tgr-dueno.

ALTER TABLE tgr_certificados
  ADD COLUMN IF NOT EXISTS revisado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revisado_at timestamptz,
  ADD COLUMN IF NOT EXISTS revisado_nota text;

CREATE INDEX IF NOT EXISTS idx_tgr_certificados_revisado ON tgr_certificados(revisado);
