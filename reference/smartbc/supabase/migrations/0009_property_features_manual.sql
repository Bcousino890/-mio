-- Features manuales por propiedad. Independiente del array `features`
-- que reescribe el scraper en cada sync. Permite a BC añadir/corregir
-- características que el scraper no puede inferir de la descripción.
--
-- La vista pública une ambos arrays deduplicando. El sync NUNCA toca
-- `features_manual` — sobrevive como `owner_*` e `internal_notes`.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS features_manual text[] NOT NULL DEFAULT '{}';
