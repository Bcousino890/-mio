-- ─────────────────────────────────────────────────────────────────────────────
-- 0028 · Enriquecimiento sii_roles_cl — coordenadas, propietario, DFL 2
-- ─────────────────────────────────────────────────────────────────────────────
-- Agrega campos que vienen en el CSV oficial SII S2-2025 pero que el parser
-- original (0021) no importaba. No requiere scraping — solo re-importar el
-- mismo CSV oficial con el parser actualizado.
--
-- DFL 2 (Decreto con Fuerza de Ley 2/1959): exención total de contribuciones
-- para propiedades ≤140 m² útiles (límite 2 propiedades por persona desde 2023).
-- Se calcula como columna generada: si superficie_terreno_m2 ≤ 140 → true.
-- NOTA: superficie_terreno_m2 en sii_roles_cl contiene la superficie CONSTRUIDA
-- útil para roles urbanos no agrícolas (departamentos/casas); para terrenos
-- esa columna es la superficie del suelo. El flag es orientativo.

ALTER TABLE sii_roles_cl
  ADD COLUMN IF NOT EXISTS lat               double precision,
  ADD COLUMN IF NOT EXISTS lng               double precision,
  ADD COLUMN IF NOT EXISTS nombre_propietario text;

-- Columna geom (Point) derivada de lat/lng — se puebla con trigger o UPDATE
ALTER TABLE sii_roles_cl
  ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326);

CREATE INDEX IF NOT EXISTS idx_sii_roles_cl_geom
  ON sii_roles_cl USING gist(geom)
  WHERE geom IS NOT NULL;

-- DFL 2 flag como columna generada (superficie útil ≤ 140 m²)
ALTER TABLE sii_roles_cl
  ADD COLUMN IF NOT EXISTS dfl2_flag boolean
  GENERATED ALWAYS AS (
    superficie_terreno_m2 IS NOT NULL AND superficie_terreno_m2 <= 140
  ) STORED;

-- Función para mantener geom sincronizada al insertar/actualizar lat/lng
CREATE OR REPLACE FUNCTION sii_roles_cl_sync_geom()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
  ELSE
    NEW.geom := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sii_roles_cl_sync_geom ON sii_roles_cl;
CREATE TRIGGER trg_sii_roles_cl_sync_geom
  BEFORE INSERT OR UPDATE OF lat, lng
  ON sii_roles_cl
  FOR EACH ROW EXECUTE FUNCTION sii_roles_cl_sync_geom();

-- Backfill geom para filas que ya tengan lat/lng (si las hay)
UPDATE sii_roles_cl
  SET geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
  WHERE lat IS NOT NULL AND lng IS NOT NULL AND geom IS NULL;
