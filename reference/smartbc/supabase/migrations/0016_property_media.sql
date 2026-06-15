-- Table for storing property media (photos, videos, plans)
-- NOTA (fix): RLS reescrita para usar el helper real is_admin() de este esquema.
-- La versión original referenciaba una tabla `internal_users` que no existe
-- (rompía el deploy). Hecha idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS)
-- porque quedó parcialmente aplicada en producción.
create table if not exists property_media (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  type text not null check (type in ('photo', 'video', 'plan')),
  file_name text not null,
  storage_path text not null unique,
  url text not null,
  has_watermark boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint valid_url check (url ~ '^https?://')
);

-- Index for quick queries by property
create index if not exists idx_property_media_property_id on property_media(property_id);
create index if not exists idx_property_media_type on property_media(type);

-- RLS
alter table property_media enable row level security;

-- Solo admin gestiona los medios. El acceso real de la app va por el service
-- role (admin client), que ignora RLS; estas políticas son defensa en fondo.
drop policy if exists "admin_select" on property_media;
create policy "admin_select" on property_media for select using (is_admin());

drop policy if exists "admin_insert" on property_media;
create policy "admin_insert" on property_media for insert with check (is_admin());

drop policy if exists "admin_delete" on property_media;
create policy "admin_delete" on property_media for delete using (is_admin());
