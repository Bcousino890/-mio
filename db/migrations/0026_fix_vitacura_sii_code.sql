-- ─────────────────────────────────────────────────────────────────────────────
-- 0026 · Corregir código SII de Vitacura, confirmado por usuario
-- ─────────────────────────────────────────────────────────────────────────────
-- El usuario confirmó que Vitacura fue subido con código 15160 (el archivo
-- real contiene roles bajo ese código). 0024 lo dejó en 15131 por adivinanza.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE chile_comunas SET sii_comuna_code = '15160' WHERE name = 'Vitacura';
