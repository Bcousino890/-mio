-- ============================================================
-- SmartBC · Tipo de propiedad + sistema de SmartLinks/shares
-- ============================================================
-- 1) Añade `properties.property_type` (piso, ático, chalet…) que el
--    scraper de Level rellena leyendo `property_type-X-es` del HTML.
-- 2) Añade `properties.building_features` jsonb para guardar metadatos
--    secundarios del edificio (planta, ascensor, año, calefacción…)
--    sin tener que añadir columnas individuales por cada uno.
-- 3) Tabla `property_shares`: tokens únicos por envío comercial. Cada
--    fila es un SmartLink que el admin envió a UN cliente concreto.
-- 4) Tabla `property_share_opens`: registro de aperturas (1 fila por
--    visita) — permite ver cuántas veces se ha abierto un link y desde
--    qué IP/UA aproximadamente.
-- ============================================================

alter table properties
  add column if not exists property_type text,
  add column if not exists building_features jsonb;

create index if not exists idx_properties_type
  on properties(property_type)
  where property_type is not null;

-- Tokens únicos por compartido. token es la parte pública de la URL
-- `/c/{token}` y debe ser difícil de adivinar (24+ chars).
create table if not exists property_shares (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  token text not null unique,
  label text,                       -- "Para María Pérez", "Anuncio FB", etc.
  created_by uuid references profiles(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_property_shares_property
  on property_shares(property_id);
create index if not exists idx_property_shares_token
  on property_shares(token);

-- Registro de aperturas. Una fila por visita; agregamos count/last_opened
-- en queries (sin contadores denormalizados para mantener simple).
create table if not exists property_share_opens (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references property_shares(id) on delete cascade,
  opened_at timestamptz not null default now(),
  ip text,
  user_agent text
);
create index if not exists idx_property_share_opens_share
  on property_share_opens(share_id, opened_at desc);

-- ============================================================
-- RLS
-- ============================================================
alter table property_shares enable row level security;
alter table property_share_opens enable row level security;

-- property_shares: staff lee y escribe; el público no ve nada (los
-- tokens son secretos compartidos por el admin).
create policy "property_shares_staff_select"
  on property_shares for select using (is_staff());
create policy "property_shares_admin_write"
  on property_shares for all using (is_admin()) with check (is_admin());

-- property_share_opens: staff lee. La escritura se hace con service role
-- desde el endpoint público, así que no necesita policy de insert.
create policy "property_share_opens_staff_select"
  on property_share_opens for select using (is_staff());
