-- ─────────────────────────────────────────────────────────────────────────────
-- 0021 · Datos catastrales reales del SII (Detalle Catastral + Rol de Cobro)
-- ─────────────────────────────────────────────────────────────────────────────
-- IMPORTANTE — origen de los datos que pueblan estas tablas:
--
--   El SII SÍ ofrece, vía su propio sitio (sii.cl → "Avalúos y Contribuciones
--   de Bienes Raíces" → "Descarga de Información Vigente por Comuna"), una
--   descarga masiva de autoservicio, gratuita, por comuna: 4 archivos de
--   "Detalle Catastral" (roles + suelos/construcciones, agrícola y no
--   agrícola) y 1 archivo de "Rol de Cobro" (Rol Semestral de Contribuciones).
--   Esto NO contradice el banner legal de cadastre-cl.mjs/0020: ese banner
--   prohíbe SCRAPING AUTOMATIZADO contra dominios sii.cl; esto es justo lo
--   opuesto — un humano descarga manualmente el archivo plano desde el botón
--   de descarga oficial del propio sitio y lo sube a este sistema. El uso
--   declarado por sii.cl para esta descarga es "personal y no comercial" —
--   por eso `sii_roles_cl`/`sii_construcciones_cl` se tratan como una señal
--   de identidad catastral interna (apoyo al matching/deduplicación), nunca
--   como dataset a redistribuir o comercializar tal cual.
--
--   `scraper/lib/sii-catastro-cl.mjs` (el módulo que parsea e inserta en estas
--   tablas) JAMÁS hace una petición HTTP contra sii.cl — solo lee archivos
--   planos que ya están en disco (subidos manualmente).
--
-- Formato de Rol de Avalúo: "manzana-predio" (campos sin ceros a la
-- izquierda), igual convención que `cadastre_parcels_cl.rol` (0020) para que
-- ambas tablas se puedan cruzar por el mismo valor de `rol`.

CREATE TABLE IF NOT EXISTS sii_roles_cl (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comuna_id                 uuid REFERENCES chile_comunas(id) ON DELETE CASCADE,
  sii_comuna_code           text NOT NULL,   -- código de comuna SII, ej. "15108" (Las Condes)
  manzana                   text NOT NULL,   -- tal cual viene en el archivo (con ceros a la izquierda)
  predio                    text NOT NULL,
  rol                       text NOT NULL,   -- "manzana-predio" normalizado (sin ceros), ej. "795-198"
  serie                     text NOT NULL CHECK (serie IN ('agricola', 'no_agricola')),

  -- Roles (Detalle Catastral, campos comunes a ambas series):
  direccion                 text,            -- dirección o nombre del predio
  avaluo_fiscal_total       bigint,
  avaluo_exento             bigint,
  contribucion_semestral    bigint,
  codigo_destino_principal  text,            -- ver TABLA DESTINOS (A..Z)
  codigo_ubicacion          text CHECK (codigo_ubicacion IN ('R', 'U', 'E')), -- R=Rural, U=Urbano, E=raro (~3 en 393k roles reales de Las Condes), no documentado en el manual SII

  -- Solo serie no agrícola (urbana) — copropiedad/edificios:
  superficie_terreno_m2     integer,
  rol_bien_comun_1          text,            -- "comuna-manzana-predio" normalizado, o NULL
  rol_bien_comun_2          text,
  rol_padre                 text,

  -- Rol de Cobro (Rol Semestral de Contribuciones) — mismo rol, archivo
  -- separado y de cadencia semestral; puede llegar antes, después o nunca
  -- respecto del Detalle Catastral, por eso vive en columnas propias en vez
  -- de pisar los campos de arriba.
  rol_cobro_anio              integer,
  rol_cobro_semestre          integer,
  rol_cobro_direccion         text,
  rol_cobro_avaluo_total      bigint,
  rol_cobro_avaluo_exento     bigint,
  rol_cobro_cuota_trimestral  bigint,
  rol_cobro_codigo_ubicacion  text CHECK (rol_cobro_codigo_ubicacion IN ('R', 'U', 'E')), -- ver nota en codigo_ubicacion arriba
  rol_cobro_codigo_destino    text,

  raw_source                text,            -- nombre del archivo de origen (ej. 'BRTMPCATASN_2026_1_15108')
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  UNIQUE (sii_comuna_code, manzana, predio)
);

CREATE INDEX IF NOT EXISTS idx_sii_roles_cl_comuna     ON sii_roles_cl(comuna_id);
CREATE INDEX IF NOT EXISTS idx_sii_roles_cl_rol        ON sii_roles_cl USING btree(sii_comuna_code, rol);
CREATE INDEX IF NOT EXISTS idx_sii_roles_cl_rbc1       ON sii_roles_cl(rol_bien_comun_1) WHERE rol_bien_comun_1 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sii_roles_cl_padre      ON sii_roles_cl(rol_padre) WHERE rol_padre IS NOT NULL;

-- `unaccent()` está marcada STABLE (no IMMUTABLE) en Postgres porque en teoría
-- depende de un diccionario configurable en runtime — pero ese diccionario no
-- cambia en la práctica para esta instalación, así que el wrapper IMMUTABLE
-- es seguro (mismo patrón documentado en la propia wiki de PostgreSQL para
-- poder indexar expresiones con unaccent).
CREATE OR REPLACE FUNCTION unaccent_immutable(text)
  RETURNS text AS $$ SELECT unaccent('unaccent', $1) $$
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

-- Trigram + unaccent para matching difuso de "dirección anuncio" vs "dirección SII"
-- (pg_trgm/unaccent ya habilitados globalmente en 0001_extensions.sql).
CREATE INDEX IF NOT EXISTS idx_sii_roles_cl_direccion_trgm
  ON sii_roles_cl USING gin (unaccent_immutable(upper(coalesce(direccion, ''))) gin_trgm_ops);

-- Líneas de construcción/suelo (1:N por rol — un edificio puede tener varias
-- líneas, ej. distintos materiales/años de ampliación; copropiedad reporta
-- 1 línea por unidad enajenable bajo su propio rol).
CREATE TABLE IF NOT EXISTS sii_construcciones_cl (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rol_id              uuid NOT NULL REFERENCES sii_roles_cl(id) ON DELETE CASCADE,
  linea               integer,                -- número correlativo de la línea dentro del rol
  material_code       text,                   -- ver TABLA CÓDIGOS DE MATERIAL (distinta para agrícola vs no agrícola)
  calidad_code        text,                   -- 1=Superior .. 5=Inferior
  anio_construccion   integer,
  superficie_m2       integer,                -- m² (o m³ para construcciones tipo silo/estanque)
  destino_code        text,                   -- ver TABLA DESTINOS
  condicion_especial  text,                   -- AL/CA/CI/MS/PZ/SB/TM o NULL
  numero_pisos        integer,
  -- Solo líneas de suelo agrícola (BRTMPCATASAL): NULL para construcciones no agrícolas.
  codigo_suelo        text,
  superficie_suelo_ha numeric(12, 2),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sii_construcciones_cl_rol ON sii_construcciones_cl(rol_id);
