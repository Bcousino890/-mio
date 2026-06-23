-- ─────────────────────────────────────────────────────────────────────────────
-- 0032 · Permitir source='catastral_cl' en cadastre_parcels_cl
-- ─────────────────────────────────────────────────────────────────────────────
-- La ingesta de GeoParquet de catastral.cl (web/app/api/admin/ingest/route.ts,
-- load-parcels/route.ts) etiqueta cada fila con source='catastral_cl', pero el
-- CHECK de 0020 solo permitía 'ide_chile' | 'manual' | 'estimated' — todo
-- intento de carga fallaba con violación de constraint. Se busca el nombre
-- real del constraint (en vez de asumir el autogenerado) para que el ALTER
-- sea seguro sin importar cómo se haya creado.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  con_name text;
BEGIN
  SELECT con.conname INTO con_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'cadastre_parcels_cl'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%source%';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE cadastre_parcels_cl DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE cadastre_parcels_cl
  ADD CONSTRAINT cadastre_parcels_cl_source_check
  CHECK (source IN ('ide_chile', 'manual', 'estimated', 'catastral_cl'));
