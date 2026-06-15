-- Limpieza puntual de fotos con marca de agua de Mobilia para 3 refs de
-- Level Real Estate (1002, 4604, 4086). Tras borrar las filas, el siguiente
-- sync de Level las re-inserta procesando fotos con la regla `-original.jpg`
-- y la marca de agua de Mobilia desaparece.
--
-- USO en el VPS:
--   psql "$DATABASE_URL" -f fix-mobilia-refs.sql
--
-- IMPORTANTE: revisa el bloque PREVIEW antes de descomentar el DELETE.
-- El script NO ejecuta nada destructivo por defecto: el DELETE va dentro
-- de un BEGIN/ROLLBACK. Cuando confirmes que el preview es correcto,
-- cambia el ROLLBACK final por COMMIT y vuelve a ejecutar.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────
-- 1) PREVIEW: qué propiedades y cuántas fotos vamos a borrar.
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  p.external_id,
  p.id          AS property_id,
  p.title,
  a.slug        AS agency_slug,
  a.name        AS agency_name,
  (SELECT count(*) FROM property_photos pp WHERE pp.property_id = p.id) AS photos,
  p.last_synced_at,
  p.archived_at
FROM properties p
JOIN agencies a ON a.id = p.agency_id
WHERE p.external_id IN ('1002', '4604', '4086')
  AND a.slug = 'level-real-estate'
ORDER BY p.external_id;

-- Comprobación de seguridad: deben aparecer EXACTAMENTE las 3 propiedades
-- de Level que esperamos. Si aparece cualquier otra (otra agencia con la
-- misma ref, propiedades archivadas que no quieres tocar, etc.), aborta.

-- ─────────────────────────────────────────────────────────────────────────
-- 2) DELETE quirúrgico — DENTRO de transacción.
--    Si el preview es correcto: cambia el ROLLBACK final por COMMIT.
-- ─────────────────────────────────────────────────────────────────────────
BEGIN;

  DELETE FROM properties p
  USING agencies a
  WHERE p.agency_id = a.id
    AND a.slug = 'level-real-estate'
    AND p.external_id IN ('1002', '4604', '4086');

  -- ON DELETE CASCADE sobre property_photos.property_id se encarga del resto.
  -- Verificamos el conteo antes de confirmar:
  SELECT
    'after_delete' AS phase,
    count(*) AS remaining_for_those_refs
  FROM properties p
  JOIN agencies a ON a.id = p.agency_id
  WHERE a.slug = 'level-real-estate'
    AND p.external_id IN ('1002', '4604', '4086');
  -- Esperado: 0

ROLLBACK;
-- ↑ Cuando hayas verificado el preview y el conteo, cambia esta línea por:
-- COMMIT;
