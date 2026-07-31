-- ─────────────────────────────────────────────────────────────────────────────
-- 0082 · Activar el barrido en Vitacura, Lo Barnechea y Colina
-- ─────────────────────────────────────────────────────────────────────────────
-- Hasta ahora solo Las Condes estaba activa (seed de 0063). Se amplía a tres
-- comunas más, elegidas para que ejerciten caminos DISTINTOS del discovery en
-- vez de repetir el mismo caso:
--
--   · Vitacura     — 1.579 en venta: por DEBAJO del tope de paginación del
--                    portal (2.000), así que se barre de una sola pasada sin
--                    bisección. Valida la vía simple, que Las Condes nunca usa.
--   · Lo Barnechea — 3.876: necesita bisección por precio (5 bandas).
--   · Colina       — 5.733: el caso más denso de la RM, 9 bandas.
--
-- Verificado en vivo contra el portal ANTES de activar (2026-07-28): la
-- bisección en UF termina en las tres, ninguna banda queda por encima del tope,
-- y la suma de bandas reconstruye el total (Colina 5.742 vs 5.733; Lo Barnechea
-- 3.877 vs 3.876 — la diferencia es inventario que entra y sale entre
-- peticiones). Ninguna tiene inventario por encima del techo de 220.000 UF.
--
-- Solo `casa` y solo estas tres: el resto de la RM sigue desactivado y se
-- activará cuando estas confirmen el comportamiento a escala. Cadencia por
-- defecto (8h) y prioridad de barrio alto, ya sembradas en 0063.
--
-- Idempotente: re-aplicarla no cambia nada si ya están activas.

UPDATE scrape_targets_cl t
SET enabled = true, updated_at = now()
FROM chile_comunas c
WHERE c.id = t.comuna_id
  AND t.property_type = 'casa'
  AND c.name IN ('Vitacura', 'Lo Barnechea', 'Colina')
  AND t.enabled = false;
