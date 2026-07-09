-- ─────────────────────────────────────────────────────────────────────────────
-- 0053 · DealerNet: relación por teléfono + tabla de relacionados (prod. 3421)
-- ─────────────────────────────────────────────────────────────────────────────
-- Dos ampliaciones al esquema de 0035:
--
-- 1. dealernet_phones_cl.relacion — cuando DealerNet anota de quién es el
--    número (no siempre es del titular: cónyuge, hijo, sociedad, ...) se
--    guarda el texto legible ("Conyuge — Estela Poblete") para mostrarlo
--    junto al teléfono en la UI.
--
-- 2. dealernet_relacionados_cl — filas RUT/NOMBRE/RELACIÓN del producto 3421
--    (Registros de Relacionados): la tabla "Relacionados" del portal
--    DealerNet (Titular, Sociedad, Socio, Cónyuge, Hijo, Empleador, ...).
--    Cada relacionado con RUT sirve además como punto de partida para una
--    nueva consulta de contactabilidad.

ALTER TABLE dealernet_phones_cl
  ADD COLUMN IF NOT EXISTS relacion text;

CREATE TABLE IF NOT EXISTS dealernet_relacionados_cl (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    uuid NOT NULL REFERENCES dealernet_contacts_cl(id) ON DELETE CASCADE,
  rut_num       bigint,            -- puede faltar si DealerNet solo entrega nombre
  rut_dv        text,
  nombre        text,
  relacion      text,              -- Titular / Sociedad / Socio / Conyuge / Hijo / ...
  product_code  text NOT NULL,     -- "3421"
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE vía índice con COALESCE: rut_num/relacion/nombre admiten NULL y un
-- UNIQUE de tabla trataría cada NULL como distinto, duplicando filas en cada
-- re-consulta del mismo RUT.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dealernet_relacionados_cl
  ON dealernet_relacionados_cl (contact_id, COALESCE(rut_num, 0), COALESCE(nombre, ''), COALESCE(relacion, ''));

CREATE INDEX IF NOT EXISTS idx_dealernet_relacionados_cl_contact
  ON dealernet_relacionados_cl (contact_id);
