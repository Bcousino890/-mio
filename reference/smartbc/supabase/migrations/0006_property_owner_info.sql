-- ============================================================
-- SmartBC · Datos internos del propietario en cada propiedad
-- ============================================================
-- Añade campos para que el admin guarde info del dueño y notas
-- internas. Estos campos NUNCA los toca el motor de sindicación
-- (diff-engine) — son siempre del admin y se conservan aunque la
-- propiedad venga de una agencia colaboradora.
-- ============================================================

alter table properties
  add column if not exists owner_name text,
  add column if not exists owner_phone text,
  add column if not exists owner_email text,
  add column if not exists internal_notes text;

-- Índice parcial: queremos poder filtrar rápido propiedades con
-- info del dueño (oportunidades calientes).
create index if not exists idx_properties_has_owner
  on properties(id)
  where owner_name is not null or owner_phone is not null;
