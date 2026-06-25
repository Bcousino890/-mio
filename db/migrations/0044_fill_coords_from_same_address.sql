-- 0044_fill_coords_from_same_address.sql
-- For roles that still lack lat/lng but share a direccion with another
-- role in the same commune that already has coordinates (buildings,
-- condominios, multi-unit lots at same address).
-- Pure SQL — no external service needed.

BEGIN;

-- Step 1: copy coords from same-address+same-commune roles
UPDATE sii_roles_cl a
SET
  lat = b.lat,
  lng = b.lng
FROM (
  -- One representative coord per (direccion, sii_comuna_code) — pick any row
  -- that already has coords; DISTINCT ON is deterministic once ORDER is fixed.
  SELECT DISTINCT ON (direccion, sii_comuna_code)
    direccion,
    sii_comuna_code,
    lat,
    lng
  FROM sii_roles_cl
  WHERE lat IS NOT NULL
    AND lng IS NOT NULL
    AND direccion IS NOT NULL
    AND sii_comuna_code IN ('15160', '15108', '15161', '14201')
  ORDER BY direccion, sii_comuna_code, rol
) b
WHERE a.direccion = b.direccion
  AND a.sii_comuna_code = b.sii_comuna_code
  AND a.lat IS NULL
  AND a.direccion IS NOT NULL
  AND a.sii_comuna_code IN ('15160', '15108', '15161', '14201');

-- Log results
DO $$
DECLARE
  v_total      INT;
  v_with_coords INT;
  v_geocodable  INT;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL),
         COUNT(*) FILTER (WHERE lat IS NULL AND direccion IS NOT NULL)
  INTO v_total, v_with_coords, v_geocodable
  FROM sii_roles_cl
  WHERE sii_comuna_code IN ('15160', '15108', '15161', '14201');

  RAISE NOTICE 'After address-copy: % of % roles have coords (%.1%% coverage); % still geocodable by address',
    v_with_coords, v_total,
    ROUND(100.0 * v_with_coords / NULLIF(v_total, 0), 1),
    v_geocodable;
END $$;

COMMIT;
