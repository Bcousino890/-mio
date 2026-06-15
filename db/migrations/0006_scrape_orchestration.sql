-- ─────────────────────────────────────────────────────────────────────────────
-- 0006 · Orquestación de scraping por zona/subzona
-- ─────────────────────────────────────────────────────────────────────────────
-- Para "que no se le escape ningún anuncio": el orquestador genera un job por
-- (zona objetivo × portal × operación) y lo pagina hasta agotar. Si el conteo
-- supera search_result_cap, se subdivide (a subzona) o se trocea por banda de
-- precio. La cola se consume con FOR UPDATE SKIP LOCKED desde los workers.

CREATE TABLE IF NOT EXISTS scrape_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id       uuid NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  portal        text NOT NULL DEFAULT 'idealista',
  operation     text NOT NULL CHECK (operation IN ('sale','rent')),
  -- Troceo opcional por precio cuando una zona supera el tope del portal.
  price_min     integer,
  price_max     integer,
  from_page     integer NOT NULL DEFAULT 1,
  to_page       integer,                      -- NULL = hasta agotar
  state         text NOT NULL DEFAULT 'queued'
                  CHECK (state IN ('queued','running','done','error')),
  priority      integer NOT NULL DEFAULT 0,   -- mayor = antes
  run_after     timestamptz NOT NULL DEFAULT now(),
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  locked_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_pick
  ON scrape_jobs(state, priority DESC, run_after)
  WHERE state = 'queued';
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_zone ON scrape_jobs(zone_id);

-- Log de ejecuciones (auditoría + métricas de cobertura)
CREATE TABLE IF NOT EXISTS scrape_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid REFERENCES scrape_jobs(id) ON DELETE SET NULL,
  zone_id        uuid REFERENCES zones(id) ON DELETE SET NULL,
  portal         text,
  operation      text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  listings_seen  integer NOT NULL DEFAULT 0,
  inserted       integer NOT NULL DEFAULT 0,
  updated        integer NOT NULL DEFAULT 0,
  gone           integer NOT NULL DEFAULT 0,
  pages_fetched  integer NOT NULL DEFAULT 0,
  hit_result_cap boolean NOT NULL DEFAULT false,  -- ⚠️ señal de que hay que subdividir
  status         text NOT NULL DEFAULT 'success' CHECK (status IN ('success','partial','error')),
  error_message  text
);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_zone    ON scrape_runs(zone_id);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_started ON scrape_runs(started_at DESC);

-- Consumo de proxy (control de presupuesto Geonode por GB)
CREATE TABLE IF NOT EXISTS proxy_usage (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL DEFAULT 'geonode',
  day         date NOT NULL DEFAULT CURRENT_DATE,
  portal      text,
  bytes_used  bigint NOT NULL DEFAULT 0,
  requests    integer NOT NULL DEFAULT 0,
  UNIQUE (provider, day, portal)
);

