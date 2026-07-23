-- ─────────────────────────────────────────────────────────────────────────────
-- 0072 · property_cl.ref_code: código interno único por propiedad canónica
--        (plan Anuncios CL · identificación estilo CRM)
-- ─────────────────────────────────────────────────────────────────────────────
-- Cada inmueble canónico necesita un identificador interno legible y único,
-- independiente de los MLC/property_code de Mercado Libre. Formato:
-- PI-<AAMM>-<secuencial de 5 dígitos>, ej. PI-2607-00042 (PI = Portal
-- Inmobiliario, la fuente; AAMM del alta; el secuencial global da unicidad).
--
-- NOTA (ver migración 0073): esta migración originalmente usaba el prefijo
-- "BC-", pero smartbc (el CRM de captaciones, BD aparte) YA usa ese patrón
-- para sus propias referencias en producción (BC-XXXX / PART-YYYY-NNNN) —
-- sin colisión técnica, pero indistinguibles en pantalla. 0073 lo corrige a
-- "PI-" para toda instalación nueva; el texto de abajo queda con el ejemplo
-- histórico "BC-" solo como referencia de formato, no como valor real final.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS property_cl_ref_seq;

ALTER TABLE property_cl
  ADD COLUMN IF NOT EXISTS ref_code text;

-- Backfill de las propiedades ya existentes, en orden de antigüedad para que el
-- secuencial refleje el orden de alta.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, first_seen_at FROM property_cl WHERE ref_code IS NULL ORDER BY first_seen_at ASC, id ASC
  LOOP
    UPDATE property_cl
      SET ref_code = 'BC-' || to_char(COALESCE(r.first_seen_at, now()), 'YYMM') || '-' ||
                     lpad(nextval('property_cl_ref_seq')::text, 5, '0')
      WHERE id = r.id;
  END LOOP;
END $$;

-- Nuevas propiedades: el código se asigna solo por DEFAULT (createPropertyCl no
-- lista ref_code en su INSERT, así que aplica este default).
ALTER TABLE property_cl
  ALTER COLUMN ref_code SET DEFAULT
    ('BC-' || to_char(now(), 'YYMM') || '-' || lpad(nextval('property_cl_ref_seq')::text, 5, '0'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_property_cl_ref_code ON property_cl(ref_code);
