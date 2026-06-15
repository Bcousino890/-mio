-- ============================================================
-- SmartBC · Fase 3a: % de venta acordada con el vendedor
-- ============================================================
-- Aplicar UNA sola vez después de 0002_phase3a_filters.sql.
-- El admin elige el % acordado con el vendedor (1-6). La agencia recibe
-- la mitad → sale_commission_pct = sale_agreed_commission_pct / 2.
-- Se almacenan ambos para mantener la traza del acuerdo original.
-- ============================================================

alter table agency_partnerships
  add column if not exists sale_agreed_commission_pct numeric(5, 2);

-- Si ya había sale_commission_pct cargado, asumimos que era ya el efectivo
-- y derivamos el acordado retroactivamente (doble del efectivo).
update agency_partnerships
   set sale_agreed_commission_pct = coalesce(
         sale_agreed_commission_pct,
         sale_commission_pct * 2
       )
 where sale_commission_pct is not null;
