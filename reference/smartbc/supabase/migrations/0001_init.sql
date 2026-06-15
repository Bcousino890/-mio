-- ============================================================
-- SmartBC · Initial schema (Fase 1 del roadmap)
-- ============================================================
-- Aplicar UNA sola vez en SQL Editor de Supabase.
-- Cubre: enums, tablas, índices, triggers, RLS y Storage.
-- ============================================================

-- ============================================================
-- 1. EXTENSIONS
-- ============================================================
create extension if not exists "pgcrypto";

-- ============================================================
-- 2. ENUMS
-- ============================================================
create type user_role as enum ('client', 'admin', 'advisor');
create type property_operation as enum ('rent', 'sale');
create type property_stay as enum ('short', 'long');
create type property_status as enum ('available', 'reserved', 'sold', 'archived');
create type property_source as enum ('manual', 'scrape', 'api');
create type visit_status as enum ('pending', 'confirmed', 'completed', 'cancelled');
create type message_sender_type as enum ('client', 'advisor', 'admin');

-- ============================================================
-- 3. TABLES
-- ============================================================

-- profiles: extiende auth.users con datos de aplicación
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'client',
  full_name text,
  email text not null,
  phone text,
  avatar_url text,
  assigned_advisor_id uuid references profiles(id) on delete set null,
  personal_shopper_terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_profiles_role on profiles(role);
create index idx_profiles_advisor on profiles(assigned_advisor_id) where assigned_advisor_id is not null;

-- agencies: agencias colaboradoras
create table agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  website text,
  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- agency_partnerships: condiciones del acuerdo con cada agencia
create table agency_partnerships (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null unique references agencies(id) on delete cascade,
  commission_pct numeric(5, 2),
  agreement_signed_at date,
  watermark_required boolean not null default true,
  attribution_visible boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- properties
create table properties (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references agencies(id) on delete set null,
  source property_source not null default 'manual',
  external_id text,
  slug text not null unique,
  title text not null,
  description text,
  operation property_operation not null,
  stay property_stay,
  status property_status not null default 'available',
  price numeric(12, 2) not null,
  bedrooms int not null default 0,
  bathrooms int not null default 0,
  square_meters int,
  zone text not null,
  address text,
  available_from date,
  features text[] not null default '{}',
  cover_photo_url text,
  last_synced_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create index idx_properties_active on properties(operation, zone, price) where archived_at is null;
create index idx_properties_status on properties(status) where archived_at is null;
create index idx_properties_bedrooms on properties(bedrooms) where archived_at is null;
create index idx_properties_agency on properties(agency_id) where archived_at is null;

-- property_photos
create table property_photos (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  url text not null,
  alt text,
  position int not null default 0,
  is_cover boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_property_photos_property on property_photos(property_id, position);

-- client_tags: catálogo administrable
create table client_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  color text,
  created_at timestamptz not null default now()
);

-- client_tag_assignments: tags asignados al cliente (M:N)
create table client_tag_assignments (
  client_id uuid not null references profiles(id) on delete cascade,
  tag_id uuid not null references client_tags(id) on delete cascade,
  assigned_by uuid references profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (client_id, tag_id)
);
create index idx_client_tag_assignments_tag on client_tag_assignments(tag_id);

-- client_preferences: filtros que el admin pre-configura para el cliente
create table client_preferences (
  client_id uuid primary key references profiles(id) on delete cascade,
  operation property_operation,
  stay property_stay,
  min_price numeric(12, 2),
  max_price numeric(12, 2),
  min_bedrooms int,
  max_bedrooms int,
  min_bathrooms int,
  min_square_meters int,
  max_square_meters int,
  zones text[] not null default '{}',
  available_from date,
  notes text,
  updated_at timestamptz not null default now()
);

-- favorites
create table favorites (
  client_id uuid not null references profiles(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, property_id)
);
create index idx_favorites_property on favorites(property_id);

-- visit_requests
create table visit_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references profiles(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  requested_at timestamptz not null,
  status visit_status not null default 'pending',
  notes text,
  confirmed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_visit_requests_client on visit_requests(client_id);
create index idx_visit_requests_property on visit_requests(property_id);
create index idx_visit_requests_status on visit_requests(status);

-- conversations: 1 conversación por cliente con la agencia
create table conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references profiles(id) on delete cascade,
  last_message_at timestamptz,
  unread_count_client int not null default 0,
  unread_count_advisor int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- messages
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  sender_type message_sender_type not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_messages_conversation on messages(conversation_id, created_at desc);

-- internal_notes: notas privadas del staff sobre clientes
create table internal_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references profiles(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_internal_notes_client on internal_notes(client_id, created_at desc);

-- app_settings: clave/valor para configuración global
create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 4. UPDATED_AT TRIGGER
-- ============================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at before update on profiles for each row execute function set_updated_at();
create trigger agencies_updated_at before update on agencies for each row execute function set_updated_at();
create trigger agency_partnerships_updated_at before update on agency_partnerships for each row execute function set_updated_at();
create trigger properties_updated_at before update on properties for each row execute function set_updated_at();
create trigger client_preferences_updated_at before update on client_preferences for each row execute function set_updated_at();
create trigger visit_requests_updated_at before update on visit_requests for each row execute function set_updated_at();
create trigger conversations_updated_at before update on conversations for each row execute function set_updated_at();
create trigger internal_notes_updated_at before update on internal_notes for each row execute function set_updated_at();

-- ============================================================
-- 5. AUTH TRIGGER: profile auto-creado al registrar usuario
-- ============================================================
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- 6. RLS: HELPER FUNCTIONS
-- ============================================================
create or replace function is_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('admin', 'advisor')
  );
$$;

create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ============================================================
-- 7. RLS: ENABLE ON ALL TABLES
-- ============================================================
alter table profiles enable row level security;
alter table agencies enable row level security;
alter table agency_partnerships enable row level security;
alter table properties enable row level security;
alter table property_photos enable row level security;
alter table client_tags enable row level security;
alter table client_tag_assignments enable row level security;
alter table client_preferences enable row level security;
alter table favorites enable row level security;
alter table visit_requests enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table internal_notes enable row level security;
alter table app_settings enable row level security;

-- ============================================================
-- 8. RLS: POLICIES
-- ============================================================

-- profiles: cliente ve y edita el suyo; staff lee/escribe todo
create policy "profiles_self_select" on profiles for select using (auth.uid() = id);
create policy "profiles_staff_select" on profiles for select using (is_staff());
create policy "profiles_self_update" on profiles for update using (auth.uid() = id) with check (auth.uid() = id and role = (select role from profiles where id = auth.uid()));
create policy "profiles_admin_all" on profiles for all using (is_admin()) with check (is_admin());

-- agencies: todos los autenticados leen; admin escribe
create policy "agencies_auth_select" on agencies for select to authenticated using (true);
create policy "agencies_admin_write" on agencies for all using (is_admin()) with check (is_admin());

-- agency_partnerships: solo staff
create policy "agency_partnerships_staff_select" on agency_partnerships for select using (is_staff());
create policy "agency_partnerships_admin_write" on agency_partnerships for all using (is_admin()) with check (is_admin());

-- properties: cualquier autenticado ve no archivadas; staff ve todas y escribe
create policy "properties_auth_select" on properties for select to authenticated using (archived_at is null);
create policy "properties_staff_select" on properties for select using (is_staff());
create policy "properties_staff_write" on properties for all using (is_staff()) with check (is_staff());

-- property_photos: visibles si la propiedad lo es
create policy "property_photos_select" on property_photos for select to authenticated using (
  exists (select 1 from properties p where p.id = property_id and (p.archived_at is null or is_staff()))
);
create policy "property_photos_staff_write" on property_photos for all using (is_staff()) with check (is_staff());

-- client_tags: catálogo legible por staff; admin gestiona
create policy "client_tags_staff_select" on client_tags for select using (is_staff());
create policy "client_tags_admin_write" on client_tags for all using (is_admin()) with check (is_admin());

-- client_tag_assignments: cliente ve los suyos; staff gestiona
create policy "client_tag_assignments_self_select" on client_tag_assignments for select using (auth.uid() = client_id);
create policy "client_tag_assignments_staff_select" on client_tag_assignments for select using (is_staff());
create policy "client_tag_assignments_staff_write" on client_tag_assignments for all using (is_staff()) with check (is_staff());

-- client_preferences: cliente ve y edita las suyas; staff gestiona
create policy "client_preferences_self_select" on client_preferences for select using (auth.uid() = client_id);
create policy "client_preferences_self_upsert" on client_preferences for all using (auth.uid() = client_id) with check (auth.uid() = client_id);
create policy "client_preferences_staff_all" on client_preferences for all using (is_staff()) with check (is_staff());

-- favorites: cliente ve y modifica los suyos; staff lee
create policy "favorites_self_all" on favorites for all using (auth.uid() = client_id) with check (auth.uid() = client_id);
create policy "favorites_staff_select" on favorites for select using (is_staff());

-- visit_requests: cliente ve/crea las suyas; staff gestiona todas
create policy "visit_requests_self_select" on visit_requests for select using (auth.uid() = client_id);
create policy "visit_requests_self_insert" on visit_requests for insert with check (auth.uid() = client_id);
create policy "visit_requests_staff_all" on visit_requests for all using (is_staff()) with check (is_staff());

-- conversations: cliente ve la suya; staff todas
create policy "conversations_self_select" on conversations for select using (auth.uid() = client_id);
create policy "conversations_staff_all" on conversations for all using (is_staff()) with check (is_staff());

-- messages: cliente ve/envía en su conversación; staff todas
create policy "messages_self_select" on messages for select using (
  exists (select 1 from conversations c where c.id = conversation_id and c.client_id = auth.uid())
);
create policy "messages_self_insert" on messages for insert with check (
  sender_id = auth.uid() and sender_type = 'client'
  and exists (select 1 from conversations c where c.id = conversation_id and c.client_id = auth.uid())
);
create policy "messages_staff_all" on messages for all using (is_staff()) with check (is_staff());

-- internal_notes: solo staff
create policy "internal_notes_staff_all" on internal_notes for all using (is_staff()) with check (is_staff());

-- app_settings: lectura autenticados; escritura admin
create policy "app_settings_auth_select" on app_settings for select to authenticated using (true);
create policy "app_settings_admin_write" on app_settings for all using (is_admin()) with check (is_admin());

-- ============================================================
-- 9. STORAGE BUCKETS
-- ============================================================
insert into storage.buckets (id, name, public)
values ('properties-photos', 'properties-photos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('agencies-logos', 'agencies-logos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Storage policies: públicos en lectura, solo staff escribe (avatars es self)
create policy "storage_public_read"
  on storage.objects for select
  using (bucket_id in ('properties-photos', 'agencies-logos', 'avatars'));

create policy "storage_staff_write_properties"
  on storage.objects for all to authenticated
  using (bucket_id = 'properties-photos' and public.is_staff())
  with check (bucket_id = 'properties-photos' and public.is_staff());

create policy "storage_staff_write_agencies"
  on storage.objects for all to authenticated
  using (bucket_id = 'agencies-logos' and public.is_staff())
  with check (bucket_id = 'agencies-logos' and public.is_staff());

create policy "storage_self_avatars"
  on storage.objects for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
