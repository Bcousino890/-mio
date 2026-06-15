-- Neutraliza los slugs de propiedades para que no expongan al cliente
-- final el portal de sindicación de origen (ej. "level-titulo-3291" →
-- "titulo-3291"). Mantiene los slugs antiguos en `legacy_slugs` para
-- redirigir SmartLinks ya enviados a clientes y no perder el tráfico.

-- 1) Tabla de slugs legacy. Una fila por slug viejo. Apunta al nuevo.
create table if not exists legacy_slugs (
  old_slug text primary key,
  new_slug text not null,
  created_at timestamptz not null default now()
);

create index if not exists legacy_slugs_new_slug_idx on legacy_slugs (new_slug);

-- Permisos: solo lectura para clientes anónimos (necesario para el
-- redirect público en /compartir y /c sin login).
alter table legacy_slugs enable row level security;
drop policy if exists legacy_slugs_select_public on legacy_slugs;
create policy legacy_slugs_select_public on legacy_slugs
  for select using (true);

-- 2) Renombrar slugs existentes que empiecen con "<agencia>-": quitar
--    el prefijo y guardar el mapping en `legacy_slugs`. Si la operación
--    deja un slug duplicado, no se renombra (caso raro pero seguro).
do $$
declare
  rec record;
  candidate text;
begin
  for rec in
    select p.id, p.slug as old_slug, a.slug as agency_slug
    from properties p
    join agencies a on a.id = p.agency_id
    where p.slug like a.slug || '-%'
  loop
    candidate := substring(rec.old_slug from length(rec.agency_slug) + 2);
    -- Si ese candidato ya existe en otra propiedad, dejamos el slug viejo
    -- intacto (no debería pasar; el external_id garantiza unicidad).
    if exists (select 1 from properties where slug = candidate and id <> rec.id) then
      continue;
    end if;
    update properties set slug = candidate where id = rec.id;
    insert into legacy_slugs (old_slug, new_slug)
    values (rec.old_slug, candidate)
    on conflict (old_slug) do nothing;
  end loop;
end $$;
