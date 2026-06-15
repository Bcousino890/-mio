-- Table for storing Idealista listing data
-- NOTA (fix): RLS reescrita para usar is_admin() (la original referenciaba una
-- tabla `internal_users` inexistente). Idempotente por seguridad.
create table if not exists idealista_listings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique references properties(id) on delete cascade,
  square_meters integer,
  built_square_meters integer,
  price integer,
  total_rental_price integer,
  has_elevator boolean default false,
  rental_type text check (rental_type in ('residential', 'temporary')),
  floor text,
  condition text check (condition in ('good', 'to-reform', 'needs-reform')),
  energy_class text,
  equipment text,
  photo_ids uuid[],
  video_ids uuid[],
  plan_ids uuid[],
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Index for quick lookups
create index if not exists idx_idealista_listings_property_id on idealista_listings(property_id);

-- RLS
alter table idealista_listings enable row level security;

-- Solo admin. El acceso de la app va por service role (ignora RLS).
drop policy if exists "admin_select" on idealista_listings;
create policy "admin_select" on idealista_listings for select using (is_admin());

drop policy if exists "admin_insert" on idealista_listings;
create policy "admin_insert" on idealista_listings for insert with check (is_admin());

drop policy if exists "admin_update" on idealista_listings;
create policy "admin_update" on idealista_listings for update using (is_admin());

drop policy if exists "admin_delete" on idealista_listings;
create policy "admin_delete" on idealista_listings for delete using (is_admin());
