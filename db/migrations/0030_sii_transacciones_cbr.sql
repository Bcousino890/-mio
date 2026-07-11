-- ─────────────────────────────────────────────────────────────────────────────
-- 0029 · Transacciones CBR — historial de escrituras por rol SII
-- ─────────────────────────────────────────────────────────────────────────────
-- Fuente: compraventas del Conservador de Bienes Raíces (CBR), con monto en
-- CLP y UF. OJO: NO existe un CSV público del CBR con precios (ver
-- docs/CBR-TRANSACCIONES-REPOS-2026.md). El registro es por jurisdicción
-- (~70 CBR) y solo expone el Índice de Propiedad (foja/número/año, SIN monto);
-- el SII solo publica agregados. Los precios de cierre viven en el Formulario
-- 2890 del SII, no publicado masivamente. Vía real → proveedor comercial
-- (databam/TocToc) importado por CSV vía POST /api/admin/transacciones-upload.
--
-- Referencia de implementación ETL (solo esquema/transformación, NO fuente de
-- datos): FelipeCabelloE/api-catastral (backend de catastral.cl; su ETL lee un
-- CSV F.2890 privado de Tremen/Newmark, no commiteado en el repo)
--   scripts/etl_cbr.py    — normalización CSV → PostgreSQL
--   scripts/compute_h3.py — cálculo índice H3 nivel 8 para comparables
--
-- H3 nivel 8 = hexágono ~460m de radio; útil para calcular mediana UF/m²
-- de transacciones recientes en el entorno inmediato de una propiedad.
--
-- El campo `foja_numero_anio` guarda el identificador CBR en formato libre
-- "FOJA/NÚMERO/AÑO" (ej. "12345/678/2023") — no hay FK porque el formato
-- varía por jurisdicción.

CREATE TABLE IF NOT EXISTS sii_transacciones_cl (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Referencia al rol (soft: un rol puede no estar en sii_roles_cl si la
  -- comuna aún no se ha importado)
  rol_id            uuid REFERENCES sii_roles_cl(id) ON DELETE SET NULL,
  sii_comuna_code   text NOT NULL,
  rol               text NOT NULL,            -- "manzana-predio" normalizado
  -- Datos de la escritura
  fecha_escritura   date,
  monto_clp         bigint,                   -- precio en pesos chilenos
  monto_uf          numeric(12, 2),           -- precio en UF (si viene en el CSV)
  superficie_m2     integer,                  -- superficie transada (puede diferir del rol)
  -- Identificador CBR
  foja_numero_anio  text,                     -- ej. "12345/678/2023"
  cbr_nombre        text,                     -- nombre del conservador (ej. "CBR Santiago")
  -- Índice espacial H3 nivel 8 (~460m) — permite comparables de zona
  h3_index          text,
  -- Métricas derivadas (calculadas en ETL o por función)
  uf_por_m2         numeric(10, 2)
    GENERATED ALWAYS AS (
      CASE WHEN superficie_m2 > 0 AND monto_uf IS NOT NULL
           THEN ROUND(monto_uf / superficie_m2, 2)
           ELSE NULL
      END
    ) STORED,
  fuente            text NOT NULL DEFAULT 'cbr',
  raw_source        text,                     -- nombre del archivo CSV de origen
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transacciones_cl_rol
  ON sii_transacciones_cl(sii_comuna_code, rol);
CREATE INDEX IF NOT EXISTS idx_transacciones_cl_rol_id
  ON sii_transacciones_cl(rol_id) WHERE rol_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transacciones_cl_h3
  ON sii_transacciones_cl(h3_index) WHERE h3_index IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transacciones_cl_fecha
  ON sii_transacciones_cl(fecha_escritura);

-- Vista: últimas N transacciones por rol (útil para la ficha de catastro)
CREATE OR REPLACE VIEW sii_transacciones_recientes_cl AS
SELECT
  t.*,
  r.direccion,
  r.codigo_destino_principal
FROM sii_transacciones_cl t
LEFT JOIN sii_roles_cl r
  ON r.sii_comuna_code = t.sii_comuna_code AND r.rol = t.rol
ORDER BY t.fecha_escritura DESC NULLS LAST;

-- Vista: mediana UF/m² por H3 (últimos 12 meses) — para valoración de mercado
CREATE OR REPLACE VIEW sii_comparables_h3_cl AS
SELECT
  h3_index,
  sii_comuna_code,
  count(*)                                    AS n_transacciones,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY uf_por_m2)::numeric, 2)
                                              AS mediana_uf_m2,
  round(avg(uf_por_m2)::numeric, 2)          AS media_uf_m2,
  min(fecha_escritura)                        AS desde,
  max(fecha_escritura)                        AS hasta
FROM sii_transacciones_cl
WHERE h3_index IS NOT NULL
  AND uf_por_m2 IS NOT NULL
  AND uf_por_m2 > 0
  AND fecha_escritura >= CURRENT_DATE - INTERVAL '12 months'
GROUP BY h3_index, sii_comuna_code;
