-- ─────────────────────────────────────────────────────────────────────────────
-- 0052 · Predios SII vía scraping de mapasui (www4.sii.cl/mapasFacadeService)
-- ─────────────────────────────────────────────────────────────────────────────
-- ORIGEN DE ESTOS DATOS — distinto y deliberadamente separado de `sii_roles_cl`
-- (0021): esta tabla se puebla con `scraper/sii-scraper/` (Python, `aiohttp`),
-- que consulta de forma AUTOMATIZADA el backend del visor de mapas del SII
-- (`mapasFacadeService`), iterando IDs (comuna, manzana, predio) e incluyendo
-- rotación de proxy/IP para sobrevivir a bloqueos del WAF.
--
-- Esto SÍ contradice el banner legal citado en 0020/0021 y docs/RC-CHILE-
-- INVESTIGACION.md: los términos de uso de sii.cl/mapasui prohíben expresamente
-- la captura automatizada y el uso comercial (uso declarado "personal y no
-- comercial"), y el propio equipo confirmó bloqueos HTTP 403 reales contra
-- ese dominio. A diferencia de `sii_roles_cl` (que SOLO ingesta archivos
-- planos descargados a mano desde el botón oficial del sitio), esta tabla
-- ingesta la salida JSONL de un scraper que sí hace requests HTTP directas a
-- sii.cl.
--
-- Se mantiene en una tabla propia — nunca mezclada con `sii_roles_cl` — para
-- no contaminar la señal "oficial" con una señal de procedencia distinta y
-- legalmente más frágil. Uso autorizado explícitamente por el responsable del
-- proyecto (2026-07-04) bajo su propio criterio de que el uso no es
-- comercial; cualquier consumidor de esta tabla debe tratarla como de menor
-- confianza legal que `sii_roles_cl` y no redistribuirla ni comercializarla.
--
-- unaccent_immutable() ya existe (definida en 0021_sii_catastro_cl.sql).

CREATE TABLE IF NOT EXISTS sii_mapasui_predios_cl (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comuna_id          uuid REFERENCES chile_comunas(id) ON DELETE CASCADE,
  sii_comuna_code    text NOT NULL,   -- comuna_id numérico del SII, ej. "15160" (Vitacura)
  rol                text NOT NULL,   -- "manzana-predio" tal cual lo devuelve mapasui (ya sin ceros), ej. "103-2"

  avaluo_total       bigint,
  avaluo_afecto      bigint,
  avaluo_exento      bigint,
  lat                double precision,
  lng                double precision,
  nombre_propiedad   text,
  direccion          text,
  area_homogenea     text,            -- código de capa WMS "Área Homogénea", ej. "SSS081"
  superficie_banda   text,            -- banda declarada por la capa WMS (ej. "HASTA 10 m²") — NO es un m² exacto, es un rango

  extraction_datetime timestamptz,    -- momento en que el scraper obtuvo el dato
  raw_source          text NOT NULL DEFAULT 'sii-scraper:mapasFacadeService',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (sii_comuna_code, rol)
);

CREATE INDEX IF NOT EXISTS idx_sii_mapasui_predios_cl_comuna ON sii_mapasui_predios_cl(comuna_id);
CREATE INDEX IF NOT EXISTS idx_sii_mapasui_predios_cl_rol    ON sii_mapasui_predios_cl USING btree(sii_comuna_code, rol);

CREATE INDEX IF NOT EXISTS idx_sii_mapasui_predios_cl_direccion_trgm
  ON sii_mapasui_predios_cl USING gin (unaccent_immutable(upper(coalesce(direccion, ''))) gin_trgm_ops);
