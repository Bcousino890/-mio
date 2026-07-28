-- ─────────────────────────────────────────────────────────────────────────────
-- 0082 · scrape_targets_cl: sembrar las comunas de la taxonomía que están FUERA
--        de la Región Metropolitana (plan Anuncios CL · H6, cobertura)
-- ─────────────────────────────────────────────────────────────────────────────
-- El seed de 0063 se limitó a `WHERE c.region = 'Región Metropolitana de
-- Santiago'`, así que las 4 comunas de veraneo/segunda vivienda que la taxonomía
-- marca como PRIORITARIAS (chile-zones.ts: Zapallar, Puchuncaví, Pucón,
-- Villarrica) no tienen ninguna fila en scrape_targets_cl. Consecuencia: la
-- promesa de "activar una comuna = un UPDATE" no se cumplía para ellas — no hay
-- fila que actualizar, hay que escribir un INSERT a mano contra producción.
--
-- Esta migración cierra ese hueco dejando sus objetivos creados y DESACTIVADOS,
-- exactamente el mismo patrón que 0063 usó para la RM: la estructura queda lista,
-- la decisión de barrer sigue siendo un UPDATE explícito.
--
--   UPDATE scrape_targets_cl SET enabled = true
--   WHERE comuna_id = (SELECT id FROM chile_comunas WHERE name = 'Zapallar');
--
-- Slugs de URL verificados en vivo contra Portal Inmobiliario (2026-07-28) con
-- el regionSlug corregido en este mismo cambio — el que conserva el artículo de
-- la región ("Región de la Araucanía" → `la-araucania`):
--   zapallar-valparaiso      → 768 casas en venta
--   puchuncavi-valparaiso    → 836
--   pucon-la-araucania       → 726
--   villarrica-la-araucania  → 546
--
-- Idempotente (ON CONFLICT DO NOTHING): re-aplicarla no duplica filas ni pisa el
-- `enabled` que se haya cambiado a mano después.

INSERT INTO scrape_targets_cl (comuna_id, property_type, operation, enabled, priority, notes)
SELECT
  c.id,
  'casa',
  op.operation,
  false,                                     -- se activan con un UPDATE, como la RM
  CASE WHEN c.priority THEN 10 ELSE 100 END, -- las 4 son priority=true en la taxonomía
  'Fuera de la RM (zona de veraneo/segunda vivienda). Slug de URL verificado 2026-07-28.'
FROM chile_comunas c
CROSS JOIN (VALUES ('sale'), ('rent')) AS op(operation)
WHERE c.name IN ('Zapallar', 'Puchuncaví', 'Pucón', 'Villarrica')
ON CONFLICT (comuna_id, property_type, operation) DO NOTHING;
