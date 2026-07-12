-- ─────────────────────────────────────────────────────────────────────────────
-- 0057 · mercado_agregado_cl — señal pública de "mercado realizado" (agregado)
-- ─────────────────────────────────────────────────────────────────────────────
-- No existe un dataset público de precios de CIERRE por predio en Chile (ver
-- docs/CBR-TRANSACCIONES-REPOS-2026.md). Lo más cercano y de fuente pública son
-- dos señales AGREGADAS que sí se pueden descargar sin login:
--
--   1. MINVU — Observatorio del Mercado de Suelo (ide.minvu.cl, open data OGC):
--      valor de suelo UF/m² por ZONA, derivado de transacciones no agrícolas del
--      SII. fuente = 'minvu_suelo'. Trae geometría de zona → se cruza por
--      ST_Contains con el punto del predio.
--   2. SII — Estadísticas de Bienes Raíces / Transferencias por comuna
--      (publicación oficial descargable, TXT/Zip): nº de operaciones y monto
--      total de transferencias por comuna/período. fuente = 'sii_transferencias'.
--      Se carga por CSV vía POST /api/admin/mercado-agregado-upload.
--
-- Esta tabla NO contiene precios por predio: es el ancla de mercado a nivel
-- zona/comuna que calibra el AVM (ver web/app/api/chile/avm/route.ts, "realizado"
-- vs "oferta"). Los cierres reales por-predio, cuando se obtengan legítimamente,
-- siguen yendo a sii_transacciones_cl vía POST /api/admin/transacciones-upload.

CREATE TABLE IF NOT EXISTS mercado_agregado_cl (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Origen del indicador. Determina qué columnas vienen pobladas.
  fuente            text NOT NULL,             -- 'minvu_suelo' | 'sii_transferencias'
  sii_comuna_code   text NOT NULL,
  -- Identificador de la zona MINVU (null para agregados a nivel comuna del SII).
  zona_id           text,
  -- Geometría de la zona (MINVU). Null cuando el agregado es de comuna completa.
  geom              geometry(MultiPolygon, 4326),
  -- Período del indicador. Formato libre por fuente: 'YYYY' | 'YYYY-S1' | 'YYYY-MM'.
  periodo           text NOT NULL,
  -- Valor de suelo UF/m² (MINVU). Ancla de "mercado realizado" para el AVM.
  valor_uf_m2       numeric(12, 2),
  -- Estadística de transferencias (SII): nº de operaciones y monto total en UF.
  n_operaciones     integer,
  monto_total_uf    numeric(16, 2),
  raw_source        text,                      -- capa WFS / archivo de origen
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mercado_agregado_cl_comuna
  ON mercado_agregado_cl(sii_comuna_code, periodo);
CREATE INDEX IF NOT EXISTS idx_mercado_agregado_cl_fuente
  ON mercado_agregado_cl(fuente);
CREATE INDEX IF NOT EXISTS idx_mercado_agregado_cl_geom
  ON mercado_agregado_cl USING GIST (geom) WHERE geom IS NOT NULL;

-- Una sola fila "vigente" por zona/comuna: el período más reciente de cada
-- (fuente, sii_comuna_code, zona_id). Es la que consume el AVM.
CREATE OR REPLACE VIEW mercado_zona_actual_cl AS
SELECT DISTINCT ON (fuente, sii_comuna_code, zona_id)
  id, fuente, sii_comuna_code, zona_id, geom, periodo,
  valor_uf_m2, n_operaciones, monto_total_uf
FROM mercado_agregado_cl
ORDER BY fuente, sii_comuna_code, zona_id, periodo DESC;
