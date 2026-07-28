-- ─────────────────────────────────────────────────────────────────────────────
-- 0082 · property_cl: marca "ya subida al CRM externo (Smart)"
-- ─────────────────────────────────────────────────────────────────────────────
-- El equipo sube las propiedades que trabaja a su CRM comercial externo
-- (Smart). Esta marca es MANUAL y sirve para no duplicar el alta: en la ficha
-- del inmueble un botón la enciende/apaga ("ya la agregué a Smart"). No es una
-- integración con Smart — solo el estado que declara el equipo, con su sello de
-- tiempo (mismo patrón que manual_pin_set_at / manual_merge_at).
--
-- NULL = todavía no está en Smart; con fecha = ya subida (y cuándo se marcó).

ALTER TABLE property_cl
  ADD COLUMN IF NOT EXISTS smart_crm_at timestamptz;

-- Consulta comercial: "¿qué ya subí a Smart y qué falta?".
CREATE INDEX IF NOT EXISTS idx_property_cl_smart_crm
  ON property_cl(smart_crm_at) WHERE smart_crm_at IS NOT NULL;
