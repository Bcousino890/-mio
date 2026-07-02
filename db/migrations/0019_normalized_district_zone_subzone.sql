-- ─────────────────────────────────────────────────────────────────────────────
-- 0019 · Estructura normalizada: DISTRITO → ZONA → SUBZONA
-- ─────────────────────────────────────────────────────────────────────────────
-- Reemplaza la anterior jerarquía "zones" de 4 niveles con una estructura
-- explícita y normalizada para Madrid:
--   districts  = distritos administrativos (21 en Madrid capital)
--   zones      = barrios/áreas dentro de un distrito
--   subzones   = subareas/urbanizaciones dentro de una zona
--
-- PROPÓSITO:
--   - Facilitar búsquedas rápidas por "todos los inmuebles en Chamberí"
--   - Denormalizar en listings y property para evitar JOINs costosos
--   - Mantener compatibilidad con la jerarquía anterior de zones
--   - Habilitar scraping dirigido por subzona si alguna supera tope de resultados
--
-- Índices y búsquedas optimizadas para:
--   - Listing.zone_id + Listing.district_id + Listing.subzone_id (denormalizados)
--   - Búsqueda "Todos los en distrito X"
--   - Búsqueda "Todos los en zona X del distrito Y"
--   - Búsqueda geoespacial si hay bounds/geom

-- ─── TABLA: districts (distritos) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS districts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL UNIQUE,           -- "Chamberí", "Salamanca", etc.
  city           text NOT NULL DEFAULT 'Madrid',
  code           text NOT NULL,                  -- código administrativo (001, 002, etc.)
  slug           text NOT NULL UNIQUE,           -- "chamberi", "salamanca" para URLs
  description    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- code debe ser único: el seed de abajo usa ON CONFLICT (code), que sin este
-- índice único fallaba SIEMPRE (los 21 distritos nunca llegaron a insertarse
-- con el script de deploy antiguo, que tragaba el error).
CREATE UNIQUE INDEX IF NOT EXISTS uq_districts_code ON districts(code);
CREATE INDEX IF NOT EXISTS idx_districts_slug     ON districts(slug);
CREATE INDEX IF NOT EXISTS idx_districts_city     ON districts(city);


-- ─── TABLA: zones (barrios/áreas) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,                -- "Barrio de Salamanca", "Almagro", etc.
  district_id      uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  slug             text NOT NULL,                -- "barrio-salamanca", "almagro" para URLs

  -- Slug de Idealista para construir búsquedas
  idealista_slug   text,                         -- "madrid/barrio-de-salamanca"
  fotocasa_slug    text,

  -- ¿Esta zona es objetivo de scraping directo?
  is_scrape_target boolean NOT NULL DEFAULT false,

  -- Tope de resultados antes de subdividir por precio o subzona
  search_result_cap integer NOT NULL DEFAULT 1800,

  -- Geometría opcional (límite de zona) para asignación por point-in-polygon
  geom             geometry(MultiPolygon, 4326),
  centroid         geometry(Point, 4326),

  description      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (district_id, slug)
);

-- La tabla zones YA existe desde 0002 (jerarquía antigua de 4 niveles), así
-- que el CREATE TABLE IF NOT EXISTS de arriba se salta y las columnas nuevas
-- hay que añadirlas explícitamente — sin esto, los índices/seeds de abajo
-- fallaban en silencio con el script de deploy antiguo (que tragaba errores).
ALTER TABLE zones ADD COLUMN IF NOT EXISTS district_id uuid REFERENCES districts(id) ON DELETE CASCADE;
ALTER TABLE zones ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE zones ADD COLUMN IF NOT EXISTS geom geometry(MultiPolygon, 4326);
ALTER TABLE zones ADD COLUMN IF NOT EXISTS description text;
-- ON CONFLICT (district_id, slug) de los seeds necesita este índice único
CREATE UNIQUE INDEX IF NOT EXISTS uq_zones_district_slug ON zones(district_id, slug);

CREATE INDEX IF NOT EXISTS idx_zones_district           ON zones(district_id);
CREATE INDEX IF NOT EXISTS idx_zones_slug              ON zones(slug);
CREATE INDEX IF NOT EXISTS idx_zones_scrape_target     ON zones(is_scrape_target) WHERE is_scrape_target;
CREATE INDEX IF NOT EXISTS idx_zones_idealista_slug    ON zones(idealista_slug);
CREATE INDEX IF NOT EXISTS idx_zones_geom              ON zones USING gist(geom);


-- ─── TABLA: subzones (urbanizaciones/subareas) ──────────────────────────────
CREATE TABLE IF NOT EXISTS subzones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,                -- "Vallehermoso", "Gaztambide", etc.
  zone_id          uuid NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  slug             text NOT NULL,                -- "vallehermoso", "gaztambide" para URLs

  -- Slug de Idealista (si esta subzona se scrapea como objetivo independiente)
  idealista_slug   text,

  -- ¿Esta subzona es objetivo de scraping directo? (si la zona padre supera tope)
  is_scrape_target boolean NOT NULL DEFAULT false,

  -- Geometría opcional (límite de subzona)
  bounds           geometry(Polygon, 4326),
  centroid         geometry(Point, 4326),

  description      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (zone_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_subzones_zone            ON subzones(zone_id);
CREATE INDEX IF NOT EXISTS idx_subzones_slug           ON subzones(slug);
CREATE INDEX IF NOT EXISTS idx_subzones_scrape_target  ON subzones(is_scrape_target) WHERE is_scrape_target;
CREATE INDEX IF NOT EXISTS idx_subzones_idealista_slug ON subzones(idealista_slug);
CREATE INDEX IF NOT EXISTS idx_subzones_bounds         ON subzones USING gist(bounds);


-- ─── ALTERACIONES en property y listings ────────────────────────────────────
-- Agregamos denormalizados para búsquedas rápidas SIN JOINs.
ALTER TABLE IF EXISTS property ADD COLUMN IF NOT EXISTS district_id uuid REFERENCES districts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS property ADD COLUMN IF NOT EXISTS subzone_id uuid REFERENCES subzones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_property_district ON property(district_id) WHERE district_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_property_subzone  ON property(subzone_id) WHERE subzone_id IS NOT NULL;

-- Búsqueda compuesta: distrito + zona + subzona
CREATE INDEX IF NOT EXISTS idx_property_district_zone_subzone
  ON property(district_id, zone_id, subzone_id) WHERE is_active;


ALTER TABLE IF EXISTS listings ADD COLUMN IF NOT EXISTS district_id uuid REFERENCES districts(id) ON DELETE SET NULL;
ALTER TABLE IF EXISTS listings ADD COLUMN IF NOT EXISTS subzone_id uuid REFERENCES subzones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_listings_district ON listings(district_id) WHERE district_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_subzone  ON listings(subzone_id) WHERE subzone_id IS NOT NULL;

-- Búsqueda compuesta: distrito + zona + subzona + activo
CREATE INDEX IF NOT EXISTS idx_listings_district_zone_subzone_active
  ON listings(district_id, zone_id, subzone_id, is_active);


-- ─── SEED: 21 distritos de Madrid ───────────────────────────────────────────
INSERT INTO districts (code, name, slug, description) VALUES
  ('001', 'Centro',       'centro',        'Centro histórico de Madrid'),
  ('002', 'Arganzuela',   'arganzuela',    'Sur de Madrid'),
  ('003', 'Retiro',       'retiro',        'Zona este con parques'),
  ('004', 'Salamanca',    'salamanca',     'Barrio residencial de lujo'),
  ('005', 'Chamberí',     'chamberi',      'Zona norte, residencial'),
  ('006', 'Tetuán',       'tetuan',        'Zona noroeste'),
  ('007', 'Chamartín',    'chamamartin',   'Zona norte con negocios'),
  ('008', 'Fuencarral-El Pardo', 'fuencarral-el-pardo', 'Zona norte extensa'),
  ('009', 'Moncloa-Aravaca', 'moncloa-aravaca', 'Zona noroeste con universidad'),
  ('010', 'Latina',       'latina',        'Centro histórico, barrio antiguo'),
  ('011', 'Carabanchel',  'carabanchel',   'Zona sur populosa'),
  ('012', 'Usera',        'usera',         'Zona sur'),
  ('013', 'Puente de Vallecas', 'puente-de-vallecas', 'Zona este-sur'),
  ('014', 'Moratalaz',    'moratalaz',     'Zona este'),
  ('015', 'Ciudad Lineal', 'ciudad-lineal', 'Zona este alargada'),
  ('016', 'Hortaleza',    'hortaleza',     'Zona norte-este'),
  ('017', 'Villaverde',   'villaverde',    'Zona sur-este'),
  ('018', 'Villa de Vallecas', 'villa-de-vallecas', 'Zona este periférica'),
  ('019', 'Vicálvaro',    'vicalvaro',     'Zona este más lejana'),
  ('020', 'San Blas-Canillejas', 'san-blas-canillejas', 'Zona este'),
  ('021', 'Barajas',      'barajas',       'Zona norte, incluye aeropuerto')
ON CONFLICT (code) DO NOTHING;


-- ─── SEED: Zonas (barrios) principales - SALAMANCA ─────────────────────────
-- Nota: Idealista expone Salamanca como un barrio, pero internamente tiene
-- subareas. Aquí creamos una zona "Barrio de Salamanca" con sus subzonas.
-- Los idealista_slug de estos seeds ya existen desde 0002 (con level de la
-- jerarquía antigua y sin district_id/slug): en vez de duplicar la zona, se
-- vincula la fila existente al distrito nuevo.
INSERT INTO zones (level, name, district_id, slug, idealista_slug, is_scrape_target, description)
  SELECT 'barrio', 'Barrio de Salamanca', id, 'barrio-salamanca', 'madrid/barrio-de-salamanca', true,
         'Zona residencial de lujo con Paseo de Recoletos'
  FROM districts WHERE code = '004'
ON CONFLICT (idealista_slug) DO UPDATE SET district_id = EXCLUDED.district_id, slug = EXCLUDED.slug;

-- Subzonas dentro de Salamanca
INSERT INTO subzones (name, zone_id, slug, is_scrape_target, description)
  SELECT 'Paseo de Recoletos', id, 'paseo-recoletos', false, 'Paseo de Recoletos y alrededores'
  FROM zones WHERE slug = 'barrio-salamanca'
ON CONFLICT (zone_id, slug) DO NOTHING;

INSERT INTO subzones (name, zone_id, slug, is_scrape_target, description)
  SELECT 'Lista', id, 'lista', false, 'Calle de la Lista y barrio oeste de Salamanca'
  FROM zones WHERE slug = 'barrio-salamanca'
ON CONFLICT (zone_id, slug) DO NOTHING;

INSERT INTO subzones (name, zone_id, slug, is_scrape_target, description)
  SELECT 'Goya', id, 'goya', true, 'Avenida Goya, zona comercial premium'
  FROM zones WHERE slug = 'barrio-salamanca'
ON CONFLICT (zone_id, slug) DO NOTHING;


-- ─── SEED: Zonas principales - CHAMBERÍ ──────────────────────────────────
INSERT INTO zones (level, name, district_id, slug, idealista_slug, is_scrape_target, description)
  SELECT 'barrio', 'Chamberí Centro', id, 'chamberi-centro', 'madrid/chamberi', true,
         'Centro del distrito, zona residencial'
  FROM districts WHERE code = '005'
ON CONFLICT (idealista_slug) DO UPDATE SET district_id = EXCLUDED.district_id, slug = EXCLUDED.slug;

-- Subzonas dentro de Chamberí
INSERT INTO subzones (name, zone_id, slug, is_scrape_target, description)
  SELECT 'Vallehermoso', id, 'vallehermoso', false, 'Barrio de Vallehermoso'
  FROM zones WHERE slug = 'chamberi-centro'
ON CONFLICT (zone_id, slug) DO NOTHING;

INSERT INTO subzones (name, zone_id, slug, is_scrape_target, description)
  SELECT 'Gaztambide', id, 'gaztambide', false, 'Barrio de Gaztambide'
  FROM zones WHERE slug = 'chamberi-centro'
ON CONFLICT (zone_id, slug) DO NOTHING;

INSERT INTO subzones (name, zone_id, slug, is_scrape_target, description)
  SELECT 'Arapiles', id, 'arapiles', false, 'Barrio de Arapiles'
  FROM zones WHERE slug = 'chamberi-centro'
ON CONFLICT (zone_id, slug) DO NOTHING;

INSERT INTO subzones (name, zone_id, slug, is_scrape_target, description)
  SELECT 'Almagro', id, 'almagro', false, 'Barrio de Almagro'
  FROM zones WHERE slug = 'chamberi-centro'
ON CONFLICT (zone_id, slug) DO NOTHING;


-- ─── SEED: Zonas principales - RETIRO ────────────────────────────────────
INSERT INTO zones (level, name, district_id, slug, idealista_slug, is_scrape_target, description)
  SELECT 'barrio', 'Retiro Centro', id, 'retiro-centro', 'madrid/retiro', true,
         'Parque del Retiro y zonas adyacentes'
  FROM districts WHERE code = '003'
ON CONFLICT (idealista_slug) DO UPDATE SET district_id = EXCLUDED.district_id, slug = EXCLUDED.slug;

INSERT INTO subzones (name, zone_id, slug, is_scrape_target, description)
  SELECT 'Ibiza', id, 'ibiza', false, 'Barrio de Ibiza'
  FROM zones WHERE slug = 'retiro-centro'
ON CONFLICT (zone_id, slug) DO NOTHING;

INSERT INTO subzones (name, zone_id, slug, is_scrape_target, description)
  SELECT 'Pacífico', id, 'pacifico', false, 'Barrio del Pacífico'
  FROM zones WHERE slug = 'retiro-centro'
ON CONFLICT (zone_id, slug) DO NOTHING;


-- ─── REFERENCIA: Mapeo de la anterior tabla "zones" (4 niveles) ─────────────
-- Nota: para migración en segundo paso, crear vista que mappe la jerarquía
-- antigua a esta nueva estructura normalizada.
-- La tabla anterior zones puede quedarse mientras se migran los datos,
-- o ser deprecada tras completar el mapeo.
