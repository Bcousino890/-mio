-- ─────────────────────────────────────────────────────────────────────────────
-- 0024 · Alinear chile_comunas.sii_comuna_code con los códigos reales
-- presentes en los archivos SII efectivamente ingeridos
-- ─────────────────────────────────────────────────────────────────────────────
-- 0023 corrigió Vitacura y Colina a partir de un diagnóstico que resultó
-- incompleto. El frontend (web/app/chile/catastro/page.tsx, array ZONES) usa
-- estos códigos para consultar sii_roles_cl.sii_comuna_code directamente, y
-- esa columna se llena tal cual desde el campo "comuna" del archivo SII
-- subido (ver web/lib/sii-catastro-ingest.ts) — por lo tanto el código real
-- es el que aparece en los archivos subidos, no una adivinanza.
--
-- Códigos correctos confirmados (coinciden con los hardcodeados en el
-- frontend, que ya están validados contra datos reales ingeridos):
--   Las Condes:    15108 (sin cambio, 0023 ya lo tenía bien)
--   Vitacura:      15131 (0023 lo dejó en 15160, incorrecto)
--   Lo Barnechea:  15111 (no estaba registrado)
--   Colina:        13301 (0023 lo cambió a 14201, incorrecto; valor de 0022)
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE chile_comunas SET sii_comuna_code = '15131' WHERE name = 'Vitacura';
UPDATE chile_comunas SET sii_comuna_code = '13301' WHERE name = 'Colina';
UPDATE chile_comunas SET sii_comuna_code = '15111' WHERE name = 'Lo Barnechea';
