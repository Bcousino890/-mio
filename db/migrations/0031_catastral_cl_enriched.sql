-- catastral_cl_enriched — datos enriquecidos de catastral.cl con geometría predial y valuación
-- Una tabla separada de sii_roles_cl: catastral.cl es fuente distinta (no oficial SII) y no
-- cubre 100% del territorio; JOIN por rol + comuna_id cuando se necesite enriquecimiento.

CREATE TABLE IF NOT EXISTS catastral_cl_enriched (
  id BIGSERIAL PRIMARY KEY,
  -- ID de la comuna (FK a chile_comunas)
  comuna_id UUID,
  -- Identificador catastral (única key de la fuente)
  rol TEXT NOT NULL,
  -- Datos básicos del predio
  manzana TEXT,
  predio TEXT,
  existePredio TEXT,
  direccion_sii TEXT,
  nombreComuna TEXT,
  -- Uso del suelo y clasificación
  eacs TEXT,
  eacano TEXT,
  eacsDescripcion TEXT,
  destinoDescripcion TEXT,
  ubicacion TEXT,
  -- Valuación fiscal (valores en CLP, strings porque catastral.cl usa esa codificación)
  valorTotal TEXT,
  valorAfecto TEXT,
  valorExento TEXT,
  valorComercial_clp_m2 TEXT,
  -- Superficie (terreno y construcción, en m²)
  supTerreno TEXT,
  supConsMt2 TEXT,
  supConsMt3 TEXT,
  medidaSup TEXT,
  medidaSupConst TEXT,
  -- Ubicación catastral
  ah TEXT,
  sector TEXT,
  lat TEXT,
  lon TEXT,
  -- Datos de predioPublicado (geometría anterior a matching)
  predioPublicado_id TEXT,
  predioPublicado_comuna TEXT,
  predioPublicado_manzana TEXT,
  predioPublicado_predio TEXT,
  predioPublicado_utm_x TEXT,
  predioPublicado_utm_y TEXT,
  -- Áreas homogéneas (CAP: Catastro Actualizado de Propiedades 2022)
  cap_ah_codigo TEXT,
  cap_ah_rango_superficie TEXT,
  cap_ah_valor_m2 TEXT,
  -- Análisis homogéneo (AH: detalles de mercado para esa clase de predio)
  ah_rangoSuperficie TEXT,
  ah_valorUnitario TEXT,
  ah_numeroMuestras TEXT,
  ah_coefVariacion TEXT,
  ah_mediana TEXT,
  ah_eac TEXT,
  ah_eacano TEXT,
  ah_utm_x TEXT,
  ah_utm_y TEXT,
  -- Comparables de venta (CSA: Centro de Similares Avaluados)
  csa_sector TEXT,
  csa_clase TEXT,
  csa_utm_x TEXT,
  csa_utm_y TEXT,
  csa_eac TEXT,
  csa_eacano TEXT,
  csa_valorUnitario TEXT,
  -- Detalle de construcción (DC: desde registro de dominio o planos)
  dc_direccion TEXT,
  dc_contribucion_semestral TEXT,
  dc_cod_destino TEXT,
  dc_avaluo_fiscal TEXT,
  dc_avaluo_exento TEXT,
  dc_sup_terreno TEXT,
  dc_cod_ubicacion TEXT,
  dc_bc1_comuna TEXT,
  dc_bc1_manzana TEXT,
  dc_bc1_predio TEXT,
  dc_bc2_comuna TEXT,
  dc_bc2_manzana TEXT,
  dc_bc2_predio TEXT,
  dc_padre_comuna TEXT,
  dc_padre_manzana TEXT,
  dc_padre_predio TEXT,
  -- Construcciones
  n_lineas_construccion TEXT,
  sup_construida_total TEXT,
  anio_construccion_min TEXT,
  anio_construccion_max TEXT,
  materiales TEXT,
  calidades TEXT,
  pisos_max TEXT,
  serie TEXT,
  -- Matching con polígono predial vectorizado
  _poly_idx INT,
  _match_method TEXT,
  _match_dist_m FLOAT8,
  pol_area_m2 FLOAT8,
  -- Geometría predial (WGS84). Sin restringir a POLYGON: algunos predios
  -- vienen como MultiPolygon (ej. predios con más de un cuerpo).
  geom GEOMETRY(GEOMETRY, 4326),
  -- Audit
  tablaOrigen TEXT,
  periodo TEXT,
  status TEXT,
  _ok TEXT,
  ingested_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT fk_comuna_id FOREIGN KEY (comuna_id) REFERENCES chile_comunas(id)
);

-- Índices para búsqueda y join
CREATE INDEX IF NOT EXISTS idx_catastral_cl_enriched_comuna_id ON catastral_cl_enriched(comuna_id);
CREATE INDEX IF NOT EXISTS idx_catastral_cl_enriched_rol ON catastral_cl_enriched(rol);
CREATE INDEX IF NOT EXISTS idx_catastral_cl_enriched_comuna_rol ON catastral_cl_enriched(comuna_id, rol);
-- Índice espacial para queries de geometría
CREATE INDEX IF NOT EXISTS idx_catastral_cl_enriched_geom ON catastral_cl_enriched USING GIST(geom);

-- Trigger: cuando hay un UPDATE en catastral_cl_enriched, actualizar ingested_at
CREATE OR REPLACE FUNCTION catastral_cl_enriched_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.ingested_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS catastral_cl_enriched_timestamp ON catastral_cl_enriched;
CREATE TRIGGER catastral_cl_enriched_timestamp
BEFORE UPDATE ON catastral_cl_enriched
FOR EACH ROW
EXECUTE FUNCTION catastral_cl_enriched_update_timestamp();
