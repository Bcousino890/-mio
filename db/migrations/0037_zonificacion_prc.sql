-- ─────────────────────────────────────────────────────────────────────────────
-- 0037 · Zonificación PRC (Planes Reguladores Comunales)
-- ─────────────────────────────────────────────────────────────────────────────
-- Almacena límites y normativas de zonas de construcción para comunas de Chile.
-- Información geoespacial del PRC de cada comuna (altura máxima, densidad, usos).
-- Fuentes:
--   - ArcGIS public services (Vitacura, Las Condes, etc.)
--   - MINVU WFS: https://geoide.minvu.cl/server/rest/services/IPT/Limites_Urbanos/MapServer
--   - Manual ingestion (GeoJSON, shapefiles)

-- ─── Tabla de zonas por comuna ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prc_zonas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comuna_id             uuid NOT NULL REFERENCES chile_comunas(id) ON DELETE CASCADE,
  sii_comuna_code       text NOT NULL,  -- Código SII (13132 = Vitacura, etc.)
  zona_nombre           text NOT NULL,  -- "Zona 1 Residencial", "Zona 2 Condominios", etc.
  zona_codigo           text,            -- Código oficial del PRC (ej. "R1", "C2")
  descripcion           text,

  -- Normativas de construcción
  altura_maxima_m       int,             -- Altura máxima permitida (metros)
  numero_pisos_maximo   int,             -- Número de pisos máximo
  densidad_viviendas_ha int,             -- Viviendas por hectárea
  fos_maximo            numeric(4,2),    -- Factor de ocupación de suelo (0.0-1.0)
  far_maximo            numeric(4,2),    -- Factor de área de restricción

  -- Usos de suelo permitidos (array de códigos: H=Habitacional, C=Comercio, I=Industria, etc.)
  usos_permitidos       text[],
  usos_prohibidos       text[],

  -- Geometría
  geom                  geometry(MultiPolygon, 4326),

  -- Trazabilidad
  source                text NOT NULL DEFAULT 'arcgis'
                          CHECK (source IN ('arcgis', 'minvu_wfs', 'manual', 'estimated')),
  source_url            text,            -- URL de origen (ej. ArcGIS service)
  confidence            text DEFAULT 'medium'
                          CHECK (confidence IN ('high', 'medium', 'low')),

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Unicidad: una comuna no tiene dos zonas con el mismo nombre
  UNIQUE(comuna_id, zona_nombre)
);

CREATE INDEX IF NOT EXISTS idx_prc_zonas_comuna_id
  ON prc_zonas(comuna_id);
CREATE INDEX IF NOT EXISTS idx_prc_zonas_sii_code
  ON prc_zonas(sii_comuna_code);
CREATE INDEX IF NOT EXISTS idx_prc_zonas_geom
  ON prc_zonas USING gist(geom);

-- ─── Enriquecimiento de sii_roles_cl ─────────────────────────────────────────
-- Agregar referencias a zona + normativas para cada rol
ALTER TABLE sii_roles_cl
  ADD COLUMN IF NOT EXISTS prc_zona_id uuid REFERENCES prc_zonas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prc_zona_nombre text,
  ADD COLUMN IF NOT EXISTS prc_altura_maxima_m int,
  ADD COLUMN IF NOT EXISTS prc_densidad_viv_ha int,
  ADD COLUMN IF NOT EXISTS prc_usos_permitidos text[];

CREATE INDEX IF NOT EXISTS idx_sii_roles_prc_zona_id
  ON sii_roles_cl(prc_zona_id);
CREATE INDEX IF NOT EXISTS idx_sii_roles_prc_altura
  ON sii_roles_cl(prc_altura_maxima_m);

-- ─── Función: ST_Intersects para asignar zona a un rol ────────────────────────
CREATE OR REPLACE FUNCTION populate_prc_zona_for_rol(
  p_rol_id uuid,
  p_sii_comuna_code text,
  p_lat float8,
  p_lng float8
)
RETURNS uuid AS $$
DECLARE
  v_zona_id uuid;
  v_punto geometry;
BEGIN
  -- Validar coordenadas
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN NULL;
  END IF;

  -- Crear punto en WGS84 (EPSG:4326)
  v_punto := ST_SetSRID(ST_Point(p_lng, p_lat), 4326);

  -- Encontrar la zona que contiene este punto
  SELECT id INTO v_zona_id
  FROM prc_zonas
  WHERE sii_comuna_code = p_sii_comuna_code
    AND geom IS NOT NULL
    AND ST_Contains(geom, v_punto)
  LIMIT 1;

  -- Actualizar el rol con la zona
  IF v_zona_id IS NOT NULL THEN
    UPDATE sii_roles_cl
    SET
      prc_zona_id = v_zona_id,
      prc_zona_nombre = (SELECT zona_nombre FROM prc_zonas WHERE id = v_zona_id),
      prc_altura_maxima_m = (SELECT altura_maxima_m FROM prc_zonas WHERE id = v_zona_id),
      prc_densidad_viv_ha = (SELECT densidad_viviendas_ha FROM prc_zonas WHERE id = v_zona_id),
      prc_usos_permitidos = (SELECT usos_permitidos FROM prc_zonas WHERE id = v_zona_id)
    WHERE id = p_rol_id;
  END IF;

  RETURN v_zona_id;
END;
$$ LANGUAGE plpgsql;

-- ─── Función: Popular todas las zonas de una comuna ──────────────────────────
CREATE OR REPLACE FUNCTION populate_prc_zonas_for_comuna(p_sii_comuna_code text)
RETURNS TABLE(rol_id uuid, prc_zona_id uuid, zona_nombre text) AS $$
BEGIN
  RETURN QUERY
  UPDATE sii_roles_cl sr
  SET
    prc_zona_id = pz.id,
    prc_zona_nombre = pz.zona_nombre,
    prc_altura_maxima_m = pz.altura_maxima_m,
    prc_densidad_viv_ha = pz.densidad_viviendas_ha,
    prc_usos_permitidos = pz.usos_permitidos
  FROM prc_zonas pz
  WHERE sr.sii_comuna_code = p_sii_comuna_code
    AND sr.lat IS NOT NULL
    AND sr.lng IS NOT NULL
    AND pz.sii_comuna_code = p_sii_comuna_code
    AND pz.geom IS NOT NULL
    AND ST_Contains(pz.geom, ST_SetSRID(ST_Point(sr.lng, sr.lat), 4326))
  RETURNING sr.id, pz.id, pz.zona_nombre;
END;
$$ LANGUAGE plpgsql;

-- ─── Vista: Roles enriquecidos con zonificación ──────────────────────────────
CREATE OR REPLACE VIEW v_sii_roles_con_zona AS
SELECT
  sr.id,
  sr.rol,
  sr.direccion,
  sr.sii_comuna_code,
  sr.lat,
  sr.lng,
  sr.avaluo_fiscal_total,
  sr.superficie_terreno_m2,
  sr.superficie_construida_total_m2,
  sr.anio_construccion,
  -- Zonificación
  pz.id AS prc_zona_id,
  pz.zona_nombre,
  pz.altura_maxima_m,
  pz.numero_pisos_maximo,
  pz.densidad_viviendas_ha,
  pz.fos_maximo,
  pz.far_maximo,
  pz.usos_permitidos,
  pz.confidence AS prc_confidence
FROM sii_roles_cl sr
LEFT JOIN prc_zonas pz ON sr.prc_zona_id = pz.id;
