-- ─────────────────────────────────────────────────────────────────────────────
-- 0002 · Taxonomía de zonas (jerárquica) — captación dirigida por zona
-- ─────────────────────────────────────────────────────────────────────────────
-- Jerarquía: municipio → distrito → barrio → urbanización.
-- Razón de ser: Idealista (y otros portales) solo exponen ~1.800 resultados
-- (~60 páginas) por búsqueda. Para NO dejarnos anuncios hay que recorrer
-- zona por zona/subzona; si una zona supera el tope, se subdivide o se
-- trocea por banda de precio. `idealista_slug` construye la URL de búsqueda:
--   https://www.idealista.com/{venta|alquiler}-viviendas/{idealista_slug}/

CREATE TABLE IF NOT EXISTS zones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level            text NOT NULL CHECK (level IN ('municipio','distrito','barrio','urbanizacion')),
  name             text NOT NULL,
  parent_id        uuid REFERENCES zones(id) ON DELETE CASCADE,
  province         text NOT NULL DEFAULT 'Madrid',
  idealista_slug   text UNIQUE,             -- ruta para construir la URL de búsqueda
  fotocasa_slug    text,
  -- ¿Esta zona es objetivo de scraping directo? (los nodos estructurales
  -- como "Madrid" municipio no se scrapean enteros; sí sus subzonas).
  is_scrape_target boolean NOT NULL DEFAULT false,
  -- Tope de resultados que el portal expone por búsqueda en esta zona.
  -- Si el conteo real lo supera, el orquestador subdivide o trocea por precio.
  search_result_cap integer NOT NULL DEFAULT 1800,
  -- Geometría opcional (límite administrativo) para asignar anuncios a zona
  -- por point-in-polygon además de por texto.
  boundary         geometry(MultiPolygon, 4326),
  centroid         geometry(Point, 4326),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zones_parent      ON zones(parent_id);
CREATE INDEX IF NOT EXISTS idx_zones_level       ON zones(level);
CREATE INDEX IF NOT EXISTS idx_zones_scrape      ON zones(is_scrape_target) WHERE is_scrape_target;
CREATE INDEX IF NOT EXISTS idx_zones_boundary    ON zones USING gist(boundary);

ALTER TABLE zones ENABLE ROW LEVEL SECURITY;  -- acceso por service_role (backend)

-- ─── Seed: zonas de prueba iniciales ────────────────────────────────────────
-- Municipios (nodos raíz)
INSERT INTO zones (level, name, idealista_slug, is_scrape_target) VALUES
  ('municipio', 'Madrid',              'madrid',                    false),
  ('municipio', 'Pozuelo de Alarcón',  'pozuelo-de-alarcon-madrid', true),
  ('municipio', 'Alcobendas',          'alcobendas',                false)
ON CONFLICT (idealista_slug) DO NOTHING;

-- Distritos de Madrid capital
INSERT INTO zones (level, name, parent_id, idealista_slug, is_scrape_target) VALUES
  ('distrito', 'Salamanca', (SELECT id FROM zones WHERE idealista_slug='madrid'), 'madrid/barrio-de-salamanca', true),
  ('distrito', 'Chamberí',  (SELECT id FROM zones WHERE idealista_slug='madrid'), 'madrid/chamberi',            false),
  ('distrito', 'Retiro',    (SELECT id FROM zones WHERE idealista_slug='madrid'), 'madrid/retiro',              false)
ON CONFLICT (idealista_slug) DO NOTHING;

-- Barrios / urbanizaciones objetivo
INSERT INTO zones (level, name, parent_id, idealista_slug, is_scrape_target) VALUES
  ('barrio',       'Almagro',     (SELECT id FROM zones WHERE idealista_slug='madrid/chamberi'), 'madrid/chamberi/almagro', true),
  ('barrio',       'Ibiza',       (SELECT id FROM zones WHERE idealista_slug='madrid/retiro'),   'madrid/retiro/ibiza',     true),
  ('urbanizacion', 'La Moraleja', (SELECT id FROM zones WHERE idealista_slug='alcobendas'),      'alcobendas/la-moraleja',  true)
ON CONFLICT (idealista_slug) DO NOTHING;
