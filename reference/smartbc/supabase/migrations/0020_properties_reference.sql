-- Referencia interna de propiedad en formato PROP-YYYY-NNNN (año + secuencial).
-- Distinto de `bc_reference` (que es BC-XXXX): esta ref es "amigable" para
-- mostrar al cliente y al admin, similar a Idealista.
-- Inmutable una vez generado, único en todo el catálogo.

create sequence if not exists property_reference_seq start 1;

-- Función para generar la referencia en formato PROP-YYYY-NNNN
create or replace function next_property_reference()
returns text
language sql
volatile
as $$
  select 'PROP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('property_reference_seq')::text, 4, '0');
$$;

alter table properties
  add column if not exists property_reference text;

-- Backfill: una referencia por cada propiedad existente, usando el año de creación.
-- Para propiedades antiguas, usando el año actual si es muy viejo (fallback).
update properties
  set property_reference =
    'PROP-' ||
    CASE
      WHEN extract(year from created_at) >= 2020 THEN to_char(created_at, 'YYYY')
      ELSE to_char(now(), 'YYYY')
    END ||
    '-' ||
    lpad(nextval('property_reference_seq')::text, 4, '0')
  where property_reference is null;

-- Constraint: única y obligatoria.
alter table properties
  alter column property_reference set not null;

create unique index if not exists properties_reference_unique
  on properties (property_reference);

-- Default para inserts futuros (manual y sindicación).
alter table properties
  alter column property_reference set default next_property_reference();
