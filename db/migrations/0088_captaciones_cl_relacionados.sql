-- ─────────────────────────────────────────────────────────────────────────────
-- 0088 · Relacionados del dueño en captaciones_cl
-- ─────────────────────────────────────────────────────────────────────────────
-- DealerNet devuelve, junto a los teléfonos, la lista de personas/empresas
-- relacionadas con el titular (RUT + nombre + tipo de relación — "Cónyuge",
-- "Suegra", "Empleador", etc.). La ficha Dealer (/dealer) ya la mostraba en su
-- tabla "Relacionados" (dealernet_relacionados_cl), pero el pipeline de
-- Captación descartaba ese dato al persistir el resultado: solo guardaba
-- phones/emails. Por eso la ficha de Captación (y la de Propiedades) solo
-- podían mostrar el TIPO de relación de cada teléfono ("Relación directa con
-- Suegra, Cuñado") sin el nombre de esa persona — el nombre vive en esta
-- lista aparte, no en el teléfono.

ALTER TABLE captaciones_cl
  ADD COLUMN IF NOT EXISTS relacionados jsonb; -- [{rut, dv, nombre, relacion}]
