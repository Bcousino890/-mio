-- ============================================================
-- SmartBC · Fase 3b: cliente crea su propia conversación
-- ============================================================
-- Aplicar UNA sola vez tras 0003_sale_agreed_commission.sql.
-- El cliente envía el primer mensaje desde /mensajes y el código intenta
-- INSERT en `conversations` si aún no existe la suya. La policy `*_self_all`
-- no estaba — solo había select para cliente — así que el insert fallaba.
-- ============================================================

create policy "conversations_self_insert" on conversations
  for insert
  with check (auth.uid() = client_id);
