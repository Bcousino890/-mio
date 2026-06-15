-- ─────────────────────────────────────────────────────────────────────────────
-- 0003 · Catastro — motor de Referencia Catastral (RC14 / RC20)
-- ─────────────────────────────────────────────────────────────────────────────
-- RC20 (20 chars) = referencia de la vivienda concreta. Es la CLAVE CANÓNICA
-- de deduplicación cross-portal del proyecto.
--   chars 1-14  = RC14 (finca/edificio; compartida por todo el portal/edificio)
--   chars 15-18 = unidad concreta (piso/puerta)
--   chars 19-20 = control
--
-- Flujo del motor:
--   1) PIP: punto del anuncio (con su radio difuso) ∩ cadastre_parcel → RC14 candidatos
--   2) enriquecer: servicios Catastro (DNPRC/RCCOOR) → unidades del edificio (cacheado)
--   3) match: m²/planta/hab del anuncio ↔ unidades → RC20 + score de confianza

-- ─── Parcelas (edificios) — geometría INSPIRE, una fila por RC14 ─────────────
CREATE TABLE IF NOT EXISTS cadastre_parcel (
  rc14            char(14) PRIMARY KEY,
  geom            geometry(MultiPolygon, 4326) NOT NULL,   -- reproyectada de 25830 en import
  centroid        geometry(Point, 4326),
  municipio_code  text,
  n_units         integer,        -- nº de inmuebles en el edificio (de DNPRC)
  year_built      integer,
  use_type        text,
  imported_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parcel_geom     ON cadastre_parcel USING gist(geom);
CREATE INDEX IF NOT EXISTS idx_parcel_centroid ON cadastre_parcel USING gist(centroid);

-- ─── Unidades (viviendas) — una fila por RC20, enriquecida bajo demanda ──────
CREATE TABLE IF NOT EXISTS cadastre_unit (
  rc20            char(20) PRIMARY KEY,
  rc14            char(14) NOT NULL REFERENCES cadastre_parcel(rc14) ON DELETE CASCADE,
  floor_label     text,           -- planta (texto: "3", "BJ", "ENT"...)
  door            text,
  area_built_m2   numeric,
  use_type        text,
  enriched_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unit_rc14 ON cadastre_unit(rc14);

-- ─── Cache de respuestas de los servicios del Catastro ──────────────────────
-- Escudo contra el rate-limit (1 rps): >90% de hits tras warm-up de las zonas.
CREATE TABLE IF NOT EXISTS cat_cache (
  cache_key   text PRIMARY KEY,            -- ej. "DNPRC:<rc14>" o "RCCOOR:<x>:<y>"
  service     text NOT NULL,               -- 'DNPRC' | 'RCCOOR' | 'CALLEJERO'
  response    jsonb NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  ttl_days    integer NOT NULL DEFAULT 3650 -- geometría/datos catastrales cambian poco
);

CREATE INDEX IF NOT EXISTS idx_cat_cache_service ON cat_cache(service);

