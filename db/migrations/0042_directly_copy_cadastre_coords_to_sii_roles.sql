-- 0042_directly_copy_cadastre_coords_to_sii_roles.sql
-- Direct coordinate population from cadastre_parcels_cl
-- Bypass commune_id matching issues by using rol-only matching

BEGIN;

-- Ensure columns exist
ALTER TABLE sii_roles_cl
ADD COLUMN IF NOT EXISTS lat DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS lng DECIMAL(11, 8);

-- Direct copy from cadastre_parcels_cl.centroid using rol matching only
-- This avoids comuna_id mismatches that may prevent matching in 0038
UPDATE sii_roles_cl sr
SET
  lat = ST_Y(cp.centroid)::DECIMAL(10, 8),
  lng = ST_X(cp.centroid)::DECIMAL(11, 8)
FROM cadastre_parcels_cl cp
WHERE sr.lat IS NULL
  AND sr.rol = cp.rol
  AND cp.centroid IS NOT NULL;

-- Log results
DO $$
DECLARE
  v_total INT;
  v_with_coords INT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM sii_roles_cl WHERE sii_comuna_code IN ('13101', '14201', '15108', '15160', '15161');
  SELECT COUNT(*) INTO v_with_coords FROM sii_roles_cl WHERE sii_comuna_code IN ('13101', '14201', '15108', '15160', '15161') AND lat IS NOT NULL AND lng IS NOT NULL;

  -- Ojo con el formato de RAISE: cada % suelto es un placeholder y %% es un
  -- % literal — el "(%.1%)" original tenía 4 placeholders para 3 argumentos y
  -- rompía la migración entera (el script de deploy antiguo tragaba el error).
  RAISE NOTICE 'Coordinate population complete: % of % roles have coords (% %%)', v_with_coords, v_total, ROUND(100.0 * v_with_coords / NULLIF(v_total, 0), 1);
END $$;

COMMIT;
