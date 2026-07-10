-- ─────────────────────────────────────────────────────────────────────────────
-- 0054 · DealerNet: categoría "laboral" en teléfonos
-- ─────────────────────────────────────────────────────────────────────────────
-- Las respuestas reales de 3410 traen una tercera categoría de teléfonos
-- (<telefono_contacto_laboral>, "LABORALES" en el impreso del portal) que el
-- CHECK de 0035 rechazaba — esos números se perdían al persistir.

ALTER TABLE dealernet_phones_cl
  DROP CONSTRAINT IF EXISTS dealernet_phones_cl_categoria_check;
ALTER TABLE dealernet_phones_cl
  ADD CONSTRAINT dealernet_phones_cl_categoria_check
  CHECK (categoria IN ('probable', 'alternativo', 'laboral'));
