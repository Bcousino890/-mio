-- El external_id es la REFERENCIA de la agencia origen, así que debe ser único
-- POR AGENCIA, no por source. Todas las agencias scrapeadas comparten
-- source='scrape', de modo que dos refs idénticas de agencias distintas
-- chocaban (ej. Housingo ref 5057 y Level ref 5057 → "duplicate key value
-- violates unique constraint properties_source_external_id_key", dejando el
-- sync en partial).
--
-- El diff engine ya empareja las propiedades existentes por (agency_id,
-- external_id), así que esta es la constraint correcta; no requiere cambios de
-- código. external_id NULL (propiedades manuales sin ref) queda excluido del
-- índice, permitiendo varios NULL.
ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_source_external_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS properties_agency_external_id_key
  ON properties (agency_id, external_id)
  WHERE external_id IS NOT NULL;
