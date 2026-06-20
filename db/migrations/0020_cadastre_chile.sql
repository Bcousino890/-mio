-- ─────────────────────────────────────────────────────────────────────────────
-- 0020 · Catastro Chile — motor de Rol de Avalúo (RC14-CL / RC20-CL)
-- ─────────────────────────────────────────────────────────────────────────────
-- Equivalente chileno de 0003_cadastre.sql + 0009_rc_resolution.sql, pero con
-- una asimetría clave frente a España: el SII NO tiene un servicio público
-- equivalente a DNPRC/RCCOOR (ver docs/RC-CHILE-INVESTIGACION.md). Los
-- términos de uso de sii.cl/mapasui PROHÍBEN expresamente captura automatizada
-- y uso comercial; se confirmaron bloqueos HTTP 403 reales. Por tanto este
-- esquema NO asume nunca una fuente sii.cl — la única fuente de geometría
-- "legalmente limpia" es IDE Chile / Geoportal.cl (SNIT), vía capas WMS/WFS
-- OGC estándar (capa "Predios" del MINVU, cobertura ~170/346 comunas).
--
-- Formato del identificador: Rol de Avalúo = "MANZANA-PREDIO" (ej. "2922-27"),
-- SIEMPRE contextualizado por comuna (el mismo par manzana-predio existe en
-- cada comuna por separado). Para edificios en copropiedad (Ley 21.442,
-- ex 19.537) el SII asigna un rol matriz + un sub-rol por unidad enajenable:
--   rol_matriz  ≈ RC14 español (parcela/edificio completo)
--   rol_unidad  ≈ RC20 español (unidad/departamento concreto, sub-rol)
--
-- Flujo del motor (ver docs/RC-CHILE-INVESTIGACION.md §5):
--   1) PIP: punto difuso del anuncio ∩ cadastre_parcels_cl (geometría IDE
--      Chile, donde la comuna esté cubierta) → candidatos de rol matriz.
--   2) Si no hay cobertura/confianza → fallback semi-manual o proveedor de
--      pago (NUNCA scraping directo de sii.cl/mapasui — ver cadastre-cl.mjs).
--   3) Resolución de sub-rol (rol_unidad) por matching m²/destino, igual que
--      el matching RC20 español, registrado en property_rc_cl.

-- PostGIS ya está habilitado globalmente en 0001_extensions.sql
-- (CREATE EXTENSION IF NOT EXISTS postgis) — no se repite aquí.

-- ─── Taxonomía de comunas — espejo 1:1 de web/lib/chile-zones.ts ────────────
CREATE TABLE IF NOT EXISTS chile_comunas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL UNIQUE,        -- "Las Condes", "Zapallar", etc.
  region           text NOT NULL,               -- "Región Metropolitana de Santiago", etc.
  provincia        text NOT NULL,               -- "Santiago", "Cordillera", "Petorca", etc.
  localidades      text[],                      -- sectores/balnearios con identidad propia (ej. "Cachagua" en Zapallar)
  priority         boolean NOT NULL DEFAULT false, -- objetivo de scraping inicial (barrio alto + zonas de veraneo)
  -- Código de comuna SII (5 dígitos, ej. "13101" = Santiago Centro). NO
  -- confirmado para todas las comunas de la taxonomía — completar bajo
  -- demanda; nunca se obtiene haciendo scraping de sii.cl (ver cadastre-cl.mjs).
  sii_comuna_code  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chile_comunas_region   ON chile_comunas(region);
CREATE INDEX IF NOT EXISTS idx_chile_comunas_priority ON chile_comunas(priority) WHERE priority;

-- ─── Parcelas catastrales — geometría de terceros (IDE Chile), NO del SII ───
-- A diferencia de cadastre_parcel (España, INSPIRE oficial y exhaustivo),
-- aquí la geometría es de cobertura y calidad desigual (~170/346 comunas vía
-- IDE Chile/Geoportal, capa "Predios" de MINVU). `source` deja explícito el
-- origen de cada fila para no tratar todo como si fuera igual de confiable.
CREATE TABLE IF NOT EXISTS cadastre_parcels_cl (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comuna_id     uuid NOT NULL REFERENCES chile_comunas(id) ON DELETE CASCADE,
  rol           text,                          -- "manzana-predio", ej. "2922-27" (nullable: el polígono puede existir sin rol asociado todavía)
  -- Procedencia del dato — nunca 'sii' / scraping directo de sii.cl/mapasui:
  --   'ide_chile'  = capa WFS/WMS de IDE Chile/Geoportal (SNIT, capa Predios MINVU)
  --   'manual'     = digitalización/corrección manual interna
  --   'estimated'  = geometría aproximada/derivada (ej. buffer sobre centroide)
  source        text NOT NULL DEFAULT 'ide_chile'
                  CHECK (source IN ('ide_chile', 'manual', 'estimated')),
  geom          geometry(MultiPolygon, 4326),
  centroid      geometry(Point, 4326),
  raw_attrs     jsonb,                         -- payload crudo de la feature (atributos WFS tal cual)
  confidence    text,                          -- libre: 'high' | 'medium' | 'low' u observación textual
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parcels_cl_geom     ON cadastre_parcels_cl USING gist(geom);
CREATE INDEX IF NOT EXISTS idx_parcels_cl_centroid ON cadastre_parcels_cl USING gist(centroid);
CREATE INDEX IF NOT EXISTS idx_parcels_cl_rol      ON cadastre_parcels_cl USING btree(rol);
CREATE INDEX IF NOT EXISTS idx_parcels_cl_comuna   ON cadastre_parcels_cl(comuna_id);

-- ─── Resolución de identidad por listing (RC14-CL / RC20-CL) ────────────────
-- Análoga a rc_resolution_request (0009) pero pensada como tabla de estado
-- resuelto por listing (no solo bitácora de peticiones), porque el scraper
-- de Chile todavía no tiene tabla `listings` propia — external_listing_id es
-- una referencia libre (texto), SIN FK dura, hasta que exista esa tabla.
CREATE TABLE IF NOT EXISTS property_rc_cl (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_listing_id  text,                      -- referencia libre al listing de origen (sin FK: tabla listings CL aún no existe)
  rol_matriz           text,                      -- equivalente RC14-CL: rol de avalúo del edificio/parcela completo
  rol_unidad           text,                      -- equivalente RC20-CL: sub-rol de la unidad de copropiedad (departamento/bodega/estacionamiento)
  comuna_id            uuid REFERENCES chile_comunas(id) ON DELETE SET NULL,
  location_confidence  text NOT NULL DEFAULT 'none'
                         CHECK (location_confidence IN ('none', 'candidate', 'pin_suspect', 'confirmed')),
  resolution_method    text,                      -- ej. 'pip_ide_chile', 'manual_review', 'provider_lookup'
  matched_parcel_id    uuid REFERENCES cadastre_parcels_cl(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Permite NULLs en rol_matriz/rol_unidad mientras la resolución está
  -- pendiente (Postgres no considera NULL = NULL en constraints UNIQUE, así
  -- que múltiples filas 'none' conviven sin chocar; solo se exige unicidad
  -- una vez que los tres campos están poblados).
  UNIQUE (rol_matriz, rol_unidad, comuna_id)
);

CREATE INDEX IF NOT EXISTS idx_property_rc_cl_external ON property_rc_cl(external_listing_id);
CREATE INDEX IF NOT EXISTS idx_property_rc_cl_comuna    ON property_rc_cl(comuna_id);
CREATE INDEX IF NOT EXISTS idx_property_rc_cl_confidence ON property_rc_cl(location_confidence);
CREATE INDEX IF NOT EXISTS idx_property_rc_cl_parcel    ON property_rc_cl(matched_parcel_id);


-- ─── SEED: 56 comunas (espejo de web/lib/chile-zones.ts CHILE_COMUNAS) ──────
-- Región Metropolitana · Provincia de Santiago (32)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Cerrillos',            'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('Cerro Navia',          'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('Conchalí',             'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('El Bosque',            'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('Estación Central',     'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('Huechuraba',           'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('Independencia',        'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('La Cisterna',          'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('La Florida',           'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('La Granja',            'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('La Pintana',           'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('La Reina',             'Región Metropolitana de Santiago', 'Santiago', NULL, true),
  ('Las Condes',           'Región Metropolitana de Santiago', 'Santiago', NULL, true),
  ('Lo Barnechea',         'Región Metropolitana de Santiago', 'Santiago', NULL, true),
  ('Lo Espejo',            'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('Lo Prado',             'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('Macul',                'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('Maipú',                'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('Ñuñoa',                'Región Metropolitana de Santiago', 'Santiago', NULL, true),
  ('Pedro Aguirre Cerda',  'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('Peñalolén',            'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('Providencia',          'Región Metropolitana de Santiago', 'Santiago', NULL, true),
  ('Pudahuel',             'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('Quilicura',            'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('Quinta Normal',        'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('Recoleta',             'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('Renca',                'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('San Joaquín',          'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('San Miguel',           'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('San Ramón',            'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('Santiago',             'Región Metropolitana de Santiago', 'Santiago', NULL, false),
  ('Vitacura',             'Región Metropolitana de Santiago', 'Santiago', NULL, true)
ON CONFLICT (name) DO NOTHING;

-- Región Metropolitana · Provincia de Cordillera (3)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Puente Alto',      'Región Metropolitana de Santiago', 'Cordillera', NULL, false),
  ('Pirque',           'Región Metropolitana de Santiago', 'Cordillera', NULL, false),
  ('San José de Maipo','Región Metropolitana de Santiago', 'Cordillera', NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región Metropolitana · Provincia de Chacabuco (3)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Colina',  'Región Metropolitana de Santiago', 'Chacabuco', NULL, false),
  ('Lampa',   'Región Metropolitana de Santiago', 'Chacabuco', NULL, false),
  ('Til Til', 'Región Metropolitana de Santiago', 'Chacabuco', NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región Metropolitana · Provincia de Maipo (4)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('San Bernardo',     'Región Metropolitana de Santiago', 'Maipo', NULL, false),
  ('Buin',             'Región Metropolitana de Santiago', 'Maipo', NULL, false),
  ('Calera de Tango',  'Región Metropolitana de Santiago', 'Maipo', NULL, false),
  ('Paine',            'Región Metropolitana de Santiago', 'Maipo', NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región Metropolitana · Provincia de Melipilla (5)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Melipilla',   'Región Metropolitana de Santiago', 'Melipilla', NULL, false),
  ('Alhué',       'Región Metropolitana de Santiago', 'Melipilla', NULL, false),
  ('Curacaví',    'Región Metropolitana de Santiago', 'Melipilla', NULL, false),
  ('María Pinto', 'Región Metropolitana de Santiago', 'Melipilla', NULL, false),
  ('San Pedro',   'Región Metropolitana de Santiago', 'Melipilla', NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Región Metropolitana · Provincia de Talagante (5)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Talagante',     'Región Metropolitana de Santiago', 'Talagante', NULL, false),
  ('El Monte',      'Región Metropolitana de Santiago', 'Talagante', NULL, false),
  ('Isla de Maipo', 'Región Metropolitana de Santiago', 'Talagante', NULL, false),
  ('Padre Hurtado', 'Región Metropolitana de Santiago', 'Talagante', NULL, false),
  ('Peñaflor',      'Región Metropolitana de Santiago', 'Talagante', NULL, false)
ON CONFLICT (name) DO NOTHING;

-- Zonas de vacaciones / segunda vivienda fuera de la RM (4)
INSERT INTO chile_comunas (name, region, provincia, localidades, priority) VALUES
  ('Zapallar',    'Región de Valparaíso',   'Petorca',    ARRAY['Cachagua'],   true),
  ('Puchuncaví',  'Región de Valparaíso',   'Valparaíso', ARRAY['Maitencillo'], true),
  ('Pucón',       'Región de la Araucanía', 'Cautín',     NULL,                true),
  ('Villarrica',  'Región de la Araucanía', 'Cautín',     NULL,                true)
ON CONFLICT (name) DO NOTHING;
