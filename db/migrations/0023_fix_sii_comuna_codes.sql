-- ─────────────────────────────────────────────────────────────────────────────
-- 0023 · Corregir códigos SII de comunas (0022 usó guesses incorrectos)
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0022 asignó códigos SII "a ojo" para todas las comunas. Sin embargo,
-- los códigos reales confirmados para las 3 comunas con datos ya ingeridos son:
--   Las Condes: 15108 (no 13114)
--   Vitacura:   15160 (no 13132)
--   Colina:     14201 (no 13301)
--
-- Estos códigos reales coinciden con los valores presentes en archivos SII
-- descargados manualmente desde sii.cl y ya ingeridos a través del workflow
-- de carga manual. Se corrigen ahora, antes de que más datos de producción
-- se vuelquen en la BD, para evitar conflictos de UNIQUE (sii_comuna_code, manzana, predio).
-- ─────────────────────────────────────────────────────────────────────────────

-- Corregir Las Condes
UPDATE chile_comunas SET sii_comuna_code = '15108' WHERE name = 'Las Condes';

-- Corregir Vitacura (nota: 0022 usó '13132' pero el real es '15160')
UPDATE chile_comunas SET sii_comuna_code = '15160' WHERE name = 'Vitacura';

-- Corregir Colina (nota: 0022 usó '13301' pero el real es '14201')
UPDATE chile_comunas SET sii_comuna_code = '14201' WHERE name = 'Colina';

-- Nota: Los demás códigos de 0022 siguen siendo guesses sin confirmar.
-- Se completan bajo demanda a medida que se ingeran datos reales de otras comunas.
