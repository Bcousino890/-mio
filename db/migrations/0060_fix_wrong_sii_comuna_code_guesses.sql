-- ─────────────────────────────────────────────────────────────────────────────
-- 0060 · Corregir códigos SII "adivinados" en 0022 que 0049 no pudo pisar
-- ─────────────────────────────────────────────────────────────────────────────
-- 0022 asignó códigos SII a ojo (comentario propio: "sin confirmar") a todas
-- las comunas. 0049 llegó después con los códigos reales extraídos de los
-- nombres de archivo parquet de catastral.cl, pero su cláusula
-- `WHERE sii_comuna_code IS NULL OR sii_comuna_code = ''` significa que NO
-- pisó ninguna comuna que 0022 ya hubiera "adivinado" (aunque estuviera mal):
-- la fila de 0049 quedó como no-op para Providencia, Ñuñoa, Zapallar,
-- Puchuncaví, Pucón y Villarrica, dejando el código incorrecto de 0022 vivo
-- en chile_comunas hasta hoy.
--
-- Consecuencia visible: /chile/catastro (array ZONES) hardcodeaba
-- `siiCode: null` para esas comunas — quienquiera que lo escribió ya sabía
-- que el valor de chile_comunas.sii_comuna_code no servía para cruzar contra
-- sii_roles_cl.sii_comuna_code, sin llegar a corregir la tabla.
--
-- Verificado ahora contra /api/chile/sii-coverage + /api/chile/sii-stats en
-- producción (direcciones reales de las calles de cada comuna, ej.
-- "MANUEL CLARO"/"ANDRES BELLO"/"RICARDO LYON"/"PEDRO VALDIVIA" → 15103 es
-- Providencia, no 13123):
--   Providencia:  13123 (guess 0022, 0 roles)   → 15103 (214.396 roles reales)
--   Ñuñoa:        13120 (guess 0022, 0 roles)   → 15105 (256.907 roles reales, ya correcto en 0049 pero bloqueado)
--   Zapallar:     05306 (guess 0022, colisiona con el código real de Quintero) → 5204 (10.366 roles reales)
--   Puchuncaví:   05401 (guess 0022, 0 roles)   → 5307 (23.149 roles reales, "AVDA DEL MAR"/"EL MEDANO")
--   Pucón:        09107 (guess 0022, 0 roles)   → 9216 (34.903 roles reales, "CAM VILLARRICA-PUCON")
--   Villarrica:   09103 (guess 0022, 0 roles)   → 9215 (45.743 roles reales, "CAM VILLARRICA A PUCON")
--   La Reina:     13113 (guess 0022, 0 roles)   → 15132 (confirmado vía /api/chile/sii-search:
--                 "AV OSSA" y "LARRAIN" — ambas avenidas insignia de La Reina —
--                 aparecen bajo este código; no tenía entrada en 0022/0049)
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE chile_comunas SET sii_comuna_code = '15103' WHERE name = 'Providencia';
UPDATE chile_comunas SET sii_comuna_code = '15105' WHERE name = 'Ñuñoa';
UPDATE chile_comunas SET sii_comuna_code = '5204'  WHERE name = 'Zapallar';
UPDATE chile_comunas SET sii_comuna_code = '5307'  WHERE name = 'Puchuncaví';
UPDATE chile_comunas SET sii_comuna_code = '9216'  WHERE name = 'Pucón';
UPDATE chile_comunas SET sii_comuna_code = '9215'  WHERE name = 'Villarrica';
UPDATE chile_comunas SET sii_comuna_code = '15132' WHERE name = 'La Reina';
