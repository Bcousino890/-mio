-- ─────────────────────────────────────────────────────────────────────────────
-- 0001 · Extensiones base de la plataforma casafari-mio
-- ─────────────────────────────────────────────────────────────────────────────
-- PostGIS    : geometría (parcelas catastrales, puntos de anuncios, PIP).
-- pg_trgm    : fuzzy text matching (dedup de fallback por título/dirección).
-- unaccent   : normalización de texto (zonas, direcciones).
-- pgcrypto   : gen_random_uuid() (Supabase ya lo trae, idempotente).
--
-- NOTA: SRID canónico del proyecto = 4326 (WGS84). La cartografía INSPIRE
-- (origen 25830) se reproyecta a 4326 EN LA IMPORTACIÓN (ogr2ogr -t_srs).
-- Así toda la geometría vive en un único SRID y el point-in-polygon no
-- necesita ST_Transform por consulta.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
