-- Referencia interna BC para cada propiedad. Independiente del `external_id`
-- (que es la referencia del portal de origen, ej. 3291 en Level). Formato
-- `BC-XXXX` con secuencia auto-incremental — única en todo el catálogo.
-- Visible en SmartLink y admin para que BC pueda "machear" referencias
-- entre lo que enseña al cliente y lo que el portal de origen muestra.

create sequence if not exists property_bc_reference_seq start 1;

create or replace function next_bc_reference()
returns text
language sql
volatile
as $$
  select 'BC-' || lpad(nextval('property_bc_reference_seq')::text, 4, '0');
$$;

alter table properties
  add column if not exists bc_reference text;

-- Backfill: una referencia BC por cada propiedad existente, en orden de
-- creación para que las más antiguas tengan las refs más bajas.
update properties
  set bc_reference = next_bc_reference()
  where bc_reference is null;

-- Constraint: única y obligatoria.
alter table properties
  alter column bc_reference set not null;

create unique index if not exists properties_bc_reference_unique
  on properties (bc_reference);

-- Default para inserts futuros (manual y sindicación).
alter table properties
  alter column bc_reference set default next_bc_reference();
