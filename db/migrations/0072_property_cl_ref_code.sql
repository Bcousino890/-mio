-- ─────────────────────────────────────────────────────────────────────────────
-- 0072 · property_cl.ref_code: código interno único por propiedad canónica
--        (plan Anuncios CL · identificación estilo CRM)
-- ─────────────────────────────────────────────────────────────────────────────
-- Cada inmueble canónico necesita un identificador interno legible y único (como
-- en el CRM de referencia), independiente de los MLC/property_code de Mercado
-- Libre. Formato: BC-<AAMM>-<secuencial de 5 dígitos>, ej. BC-2607-00042
-- (BC = Benjamín Cousiño; AAMM del alta; el secuencial global garantiza unicidad).
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
