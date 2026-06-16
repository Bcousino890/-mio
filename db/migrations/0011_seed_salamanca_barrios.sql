-- ─────────────────────────────────────────────────────────────────────────────
-- 0011 · Seed de barrios del distrito de Salamanca (objetivos de scraping)
-- ─────────────────────────────────────────────────────────────────────────────
-- El distrito "Salamanca" (madrid/barrio-de-salamanca) se subdivide en sus 6
-- barrios oficiales. Empezamos la captación por Goya. Cada barrio es objetivo
-- directo de scraping; el orquestador genera un job por (barrio × operación).

INSERT INTO zones (level, name, parent_id, idealista_slug, is_scrape_target) VALUES
  ('barrio', 'Goya',         (SELECT id FROM zones WHERE idealista_slug='madrid/barrio-de-salamanca'), 'madrid/barrio-de-salamanca/goya',                  true),
  ('barrio', 'Recoletos',    (SELECT id FROM zones WHERE idealista_slug='madrid/barrio-de-salamanca'), 'madrid/barrio-de-salamanca/recoletos',             true),
  ('barrio', 'Lista',        (SELECT id FROM zones WHERE idealista_slug='madrid/barrio-de-salamanca'), 'madrid/barrio-de-salamanca/lista',                 true),
  ('barrio', 'Castellana',   (SELECT id FROM zones WHERE idealista_slug='madrid/barrio-de-salamanca'), 'madrid/barrio-de-salamanca/castellana',            true),
  ('barrio', 'Guindalera',   (SELECT id FROM zones WHERE idealista_slug='madrid/barrio-de-salamanca'), 'madrid/barrio-de-salamanca/guindalera',            true),
  ('barrio', 'Fuente del Berro', (SELECT id FROM zones WHERE idealista_slug='madrid/barrio-de-salamanca'), 'madrid/barrio-de-salamanca/fuente-del-berro', true)
ON CONFLICT (idealista_slug) DO NOTHING;
