-- ─────────────────────────────────────────────────────────────────────────────
-- 0055 · watchlists_cl — zonas de seguimiento (farming) con novedades
-- ─────────────────────────────────────────────────────────────────────────────
-- Una fila por zona que el equipo decide "seguir" en el visor catastral. La
-- zona es la misma figura (polígono/círculo/rectángulo) que se dibuja en
-- /chile/catastro para el análisis puntual, pero aquí se persiste en servidor
-- (las "zonas guardadas" de la Fase 4 viven solo en localStorage del
-- navegador). Sobre esta tabla se calculan las "novedades": cuántos anuncios
-- de venta activos hay hoy dentro de la zona vs cuántos había la última vez
-- que el usuario la marcó como vista (baseline). Es la base para alertas.
--
-- App de un solo tenant interno → watchlist compartida, sin owner por usuario.
-- La entrega por email/push queda para un job aparte (requiere SMTP/infra); el
-- cálculo de novedades es on-demand cuando se abre el panel.

CREATE TABLE IF NOT EXISTS watchlists_cl (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  sii_comuna_code    text NOT NULL,
  -- Figura dibujada, mismo shape que usa /api/chile/sii-roles-in-zone:
  -- { type:'polygon'|'circle'|'rectangle', coordinates?:[[lat,lng],...],
  --   center?:[lat,lng], radius?:metros }
  shape              jsonb NOT NULL,
  -- Baseline: conteos al momento de crear / marcar visto. El delta contra el
  -- conteo actual = novedades desde la última revisión.
  baseline_listings  integer NOT NULL DEFAULT 0,
  baseline_roles     integer NOT NULL DEFAULT 0,
  last_checked_at    timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_watchlists_cl_comuna ON watchlists_cl(sii_comuna_code);
