-- 0041_directly_populate_sii_coordinates_from_rol.sql
-- Ensure lat/lng columns are populated from cadastre_parcels_cl centroid
-- Multiple fallback approaches to handle different scenarios

BEGIN;

-- Ensure lat/lng columns exist
ALTER TABLE sii_roles_cl
ADD COLUMN IF NOT EXISTS lat DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS lng DECIMAL(11, 8);

-- Approach 1: Copy from existing latitude/longitude columns if populated
UPDATE sii_roles_cl
SET
  lat = latitude::DECIMAL(10, 8),
  lng = longitude::DECIMAL(11, 8)
WHERE lat IS NULL AND latitude IS NOT NULL;

-- Approach 2: Copy from cadastre_parcels_cl.centroid (via ST_X/ST_Y extraction)
-- This handles the case where 0037 and 0038 executed successfully
UPDATE sii_roles_cl sr
SET
  lat = ST_Y(cp.centroid)::DECIMAL(10, 8),
  lng = ST_X(cp.centroid)::DECIMAL(11, 8)
FROM cadastre_parcels_cl cp
WHERE sr.lat IS NULL
  AND sr.rol = cp.rol
  AND sr.sii_comuna_code = '13101' AND cp.rol LIKE '1000-%'  -- Las Condes pattern
  AND cp.centroid IS NOT NULL;

UPDATE sii_roles_cl sr
SET
  lat = ST_Y(cp.centroid)::DECIMAL(10, 8),
  lng = ST_X(cp.centroid)::DECIMAL(11, 8)
FROM cadastre_parcels_cl cp
WHERE sr.lat IS NULL
  AND sr.rol = cp.rol
  AND sr.sii_comuna_code = '15160' AND cp.rol LIKE '111-%'  -- Vitacura pattern
  AND cp.centroid IS NOT NULL;

UPDATE sii_roles_cl sr
SET
  lat = ST_Y(cp.centroid)::DECIMAL(10, 8),
  lng = ST_X(cp.centroid)::DECIMAL(11, 8)
FROM cadastre_parcels_cl cp
WHERE sr.lat IS NULL
  AND sr.rol = cp.rol
  AND sr.sii_comuna_code = '15161' AND cp.rol LIKE '113-%'  -- Lo Barnechea pattern
  AND cp.centroid IS NOT NULL;

UPDATE sii_roles_cl sr
SET
  lat = ST_Y(cp.centroid)::DECIMAL(10, 8),
  lng = ST_X(cp.centroid)::DECIMAL(11, 8)
FROM cadastre_parcels_cl cp
WHERE sr.lat IS NULL
  AND sr.rol = cp.rol
  AND sr.sii_comuna_code = '14201' AND cp.rol LIKE '999-%'  -- Colina pattern
  AND cp.centroid IS NOT NULL;

COMMIT;
