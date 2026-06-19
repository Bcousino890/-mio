-- ─────────────────────────────────────────────────────────────────────────────
-- 0016 · Agregar columna reference a listings
-- ─────────────────────────────────────────────────────────────────────────────
-- Agregamos columna para guardar la referencia/código de referencia del anuncio
-- en Idealista (ej: "1116", "W-0462UX"). Es útil para reconciliación y auditoría.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS reference text;

-- Índice para búsqueda rápida por referencia
CREATE INDEX IF NOT EXISTS idx_listings_reference
  ON listings(reference) WHERE reference IS NOT NULL;
