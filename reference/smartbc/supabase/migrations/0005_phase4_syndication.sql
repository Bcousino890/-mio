-- ============================================================
-- SmartBC · Fase 4 · Infraestructura de sindicación
-- ============================================================
-- Añade:
--   · Enums sync_status y feed_status
--   · Tabla agency_feeds (1:1 con agencies)
--   · Tabla sync_logs (historial de runs)
--   · Columna properties.source_url (link al listing original)
--   · Trigger updated_at en agency_feeds
--   · RLS: staff lee, admin gestiona
-- ============================================================

create type sync_status as enum ('running', 'success', 'partial', 'error');
create type feed_health as enum ('healthy', 'warning', 'error', 'idle');

-- agency_feeds: configuración de sindicación por agencia
create table agency_feeds (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null unique references agencies(id) on delete cascade,
  scraper_key text not null,
  feed_url text,
  active boolean not null default true,
  frequency_hours int not null default 6,
  last_run_at timestamptz,
  last_status sync_status,
  last_error text,
  health feed_health not null default 'idle',
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_agency_feeds_active on agency_feeds(active) where active = true;
create index idx_agency_feeds_next_run on agency_feeds(next_run_at) where active = true;

create trigger agency_feeds_updated_at
  before update on agency_feeds
  for each row execute function set_updated_at();

-- sync_logs: una fila por intento de sync
create table sync_logs (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null references agency_feeds(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status sync_status not null default 'running',
  triggered_by text not null default 'cron',
  properties_seen int not null default 0,
  properties_inserted int not null default 0,
  properties_updated int not null default 0,
  properties_archived int not null default 0,
  properties_skipped int not null default 0,
  photos_processed int not null default 0,
  error_message text,
  details jsonb
);
create index idx_sync_logs_feed_started on sync_logs(feed_id, started_at desc);
create index idx_sync_logs_status on sync_logs(status);

-- Link al listing en la web origen (para auditoría y atribución opcional)
alter table properties add column if not exists source_url text;

-- ============================================================
-- RLS
-- ============================================================
alter table agency_feeds enable row level security;
alter table sync_logs enable row level security;

create policy "agency_feeds_staff_select"
  on agency_feeds for select using (is_staff());
create policy "agency_feeds_admin_write"
  on agency_feeds for all using (is_admin()) with check (is_admin());

create policy "sync_logs_staff_select"
  on sync_logs for select using (is_staff());
create policy "sync_logs_admin_write"
  on sync_logs for all using (is_admin()) with check (is_admin());
