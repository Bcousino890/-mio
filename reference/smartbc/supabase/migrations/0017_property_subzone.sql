-- Subzona (barrio dentro del distrito): Goya/Lista/Recoletos dentro de
-- Salamanca, Almagro/Trafalgar dentro de Chamberí, etc. La rellenan los
-- scrapers cuando el origen la expone (ej. TerraHomes). El `zone` sigue siendo
-- el distrito; el filtro jerárquico usa zone (distrito) → subzone (barrio).
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS subzone text;

CREATE INDEX IF NOT EXISTS idx_properties_subzone
  ON properties (subzone)
  WHERE subzone IS NOT NULL AND archived_at IS NULL;
