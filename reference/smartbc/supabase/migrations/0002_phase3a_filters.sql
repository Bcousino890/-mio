-- ============================================================
-- SmartBC · Fase 3a (cierre): persistir filtros y umbrales
-- ============================================================
-- Aplicar UNA sola vez en SQL Editor de Supabase, después de 0001_init.sql.
-- Añade los campos UI introducidos en la sesión 2026-05-12:
--   * client_preferences: composición del grupo + mascotas
--   * agency_partnerships: comisiones y umbrales separados alquiler/venta
-- ============================================================

-- ----- client_preferences --------------------------------------------------
alter table client_preferences
  add column if not exists occupants int,
  add column if not exists students int,
  add column if not exists workers int,
  add column if not exists pets boolean not null default false;

-- ----- agency_partnerships -------------------------------------------------
-- Migramos `commission_pct` (única) a alquiler/venta separadas y añadimos
-- los umbrales de precio a partir de los que aplica la colaboración.
alter table agency_partnerships
  add column if not exists rent_commission_pct numeric(5, 2),
  add column if not exists sale_commission_pct numeric(5, 2),
  add column if not exists rent_commission_min_price numeric(12, 2),
  add column if not exists sale_commission_min_price numeric(12, 2);

-- Copiar el valor existente a ambas columnas como punto de partida.
update agency_partnerships
   set rent_commission_pct = coalesce(rent_commission_pct, commission_pct),
       sale_commission_pct = coalesce(sale_commission_pct, commission_pct)
 where commission_pct is not null;
