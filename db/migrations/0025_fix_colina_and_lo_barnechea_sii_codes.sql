-- ─────────────────────────────────────────────────────────────────────────────
-- 0025 · Corregir (de nuevo) los códigos SII de Colina y Lo Barnechea,
-- confirmados contra los archivos SII realmente subidos e ingeridos
-- ─────────────────────────────────────────────────────────────────────────────
-- 0024 cambió Colina a '13301' y Lo Barnechea a '15111' asumiendo que el
-- array ZONES del frontend ya estaba validado contra datos reales. Resultó
-- ser otra adivinanza. El panel de carga (Configuración → Subir archivos
-- SII) confirma los resultados reales de la ingesta agrupados por el código
-- de comuna presente en el archivo:
--   "Comuna 14201 · Roles: 60146"  → direcciones de Colina (Chicureo, etc.)
--   "Comuna 15161 · Roles: 75234"  → direcciones de Lo Barnechea
--     (AV LA DEHESA, NIDO DE AGUILAS, AV CAM LOS TRAPENSES, CLUB DE GOLF —
--     confirmado vía /api/chile/sii-roles-list?sii_comuna_code=15161)
-- 0023 ya tenía el valor de Colina (14201) correcto antes de que 0024 lo
-- pisara; Lo Barnechea no estaba registrado en ninguna migración anterior.
--
-- Vitacura (15131) y Las Condes (15108) quedan sin tocar: no hay evidencia
-- de que esos archivos se hayan subido con éxito todavía.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE chile_comunas SET sii_comuna_code = '14201' WHERE name = 'Colina';
UPDATE chile_comunas SET sii_comuna_code = '15161' WHERE name = 'Lo Barnechea';
