-- ─────────────────────────────────────────────────────────────────────────────
-- 0083 · Activar el barrido de Vitacura, Las Condes, Lo Barnechea y Colina
-- ─────────────────────────────────────────────────────────────────────────────
-- Primera ampliación de cobertura más allá del piloto (plan Anuncios CL · H6,
-- Fase 6). Hasta aquí solo Las Condes estaba `enabled` (seed de 0063).
--
-- Va como migración y no como UPDATE suelto en la VPS para que quede versionado
-- QUÉ se activó y CUÁNDO — mismo criterio que 0060/0061 con los códigos SII.
-- Sigue sin ser código de aplicación: el worker lee esta tabla en caliente, no
-- hace falta redesplegar el scraper.
--
-- Volumen medido en vivo contra el portal (2026-07-28, casas usadas):
--
--   comuna          venta   arriendo   ¿supera el tope de 2.000?
--   Vitacura         1.578        93   no (una sola banda)
--   Las Condes       3.470       214   venta → bisección por precio en UF
--   Lo Barnechea     3.874       372   venta → bisección por precio en UF
--   Colina           5.717       719   venta → bisección por precio en UF
--   ─────────────────────────────────────────────────────────────────
--   TOTAL           14.639     1.398   = 16.037 anuncios
--
-- Las Condes ya está ingerida, así que entran ~12.300 fichas nuevas a la cola
-- `detail-cl`. A las ~15 fichas/min que sostiene hoy, la puesta al día son
-- ~14 h. No hay que hacer nada: el discovery encola los que faltan con
-- priority=100, por delante de los jobs que solo refrescan lo ya guardado.
--
-- Prerrequisitos que trae este mismo cambio (sin ellos, activar Colina hacía
-- daño): la guarda de slug de comuna, el singletonKey del scheduler de discovery
-- —sin él, 8 objetivos en cola se re-encolaban cada 15 min— y la comparación de
-- precios en la moneda de publicación.
--
-- Idempotente: re-aplicarla no cambia nada si ya están activas.

UPDATE scrape_targets_cl t
SET
  enabled = true,
  -- Colina se sembró con priority=100: no está en el "barrio alto" de la
  -- taxonomía, pero es la comuna de MÁS stock de las cuatro (5.717 en venta) y
  -- ahora forma parte del conjunto activo. Se iguala a 10 para que no quede
  -- siempre la última cuando haya más objetivos vencidos que capacidad.
  priority = 10,
  updated_at = now()
FROM chile_comunas c
WHERE c.id = t.comuna_id
  AND t.property_type = 'casa'
  AND c.name IN ('Vitacura', 'Las Condes', 'Lo Barnechea', 'Colina')
  -- No re-escribir filas que ya están como se quiere (mantiene el UPDATE limpio
  -- y deja `updated_at` como marca real del último cambio de configuración).
  AND (t.enabled IS DISTINCT FROM true OR t.priority IS DISTINCT FROM 10);
