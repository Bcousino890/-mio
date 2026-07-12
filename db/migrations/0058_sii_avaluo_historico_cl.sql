-- ─────────────────────────────────────────────────────────────────────────────
-- 0058 · sii_avaluo_historico_cl — serie histórica de avalúo por rol (2018→)
-- ─────────────────────────────────────────────────────────────────────────────
-- Fuente: CSVs históricos del SII procesados por catastral.cl / roles-backend
-- (tabla `catastro_historico`, ~136M registros, 16 períodos 2018-2025, 13
-- columnas clave). Público y descargable (ver docs/CBR-TRANSACCIONES-REPOS-2026.md).
--
-- OJO: esto NO es precio de venta — es la evolución del AVALÚO FISCAL del predio
-- en el tiempo. Sirve como tendencia/contexto en la ficha del rol, no como cierre.
-- El avalúo VIGENTE (último período) sigue viviendo en sii_roles_cl; esta tabla
-- guarda solo la serie histórica para el sparkline y análisis de tendencia.

CREATE TABLE IF NOT EXISTS sii_avaluo_historico_cl (
  sii_comuna_code   text    NOT NULL,
  rol               text    NOT NULL,           -- "manzana-predio" normalizado
  periodo           text    NOT NULL,           -- 'YYYY-1' | 'YYYY-2' (semestre)
  avaluo_total      bigint,                      -- avalúo fiscal total (CLP)
  avaluo_exento     bigint,                      -- avalúo exento (CLP)
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sii_comuna_code, rol, periodo)
);

CREATE INDEX IF NOT EXISTS idx_avaluo_historico_cl_rol
  ON sii_avaluo_historico_cl(sii_comuna_code, rol);
CREATE INDEX IF NOT EXISTS idx_avaluo_historico_cl_periodo
  ON sii_avaluo_historico_cl(periodo);
