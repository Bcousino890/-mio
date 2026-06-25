-- 0038_add_coordinates_to_sii_roles.sql
-- Add centroid coordinates to sii_roles_cl from cadastre_parcels_cl
-- Enables map display and spatial queries on roles

BEGIN;

-- Add coordinate columns to sii_roles_cl (if not already present)
ALTER TABLE sii_roles_cl 
ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
ADD COLUMN IF NOT EXISTS centroid geometry(Point, 4326);

-- Create index for spatial queries
CREATE INDEX IF NOT EXISTS idx_sii_roles_cl_centroid 
ON sii_roles_cl USING gist(centroid);

-- Update coordinates from cadastre_parcels_cl
UPDATE sii_roles_cl sr
SET 
  latitude = ST_Y(cp.centroid)::DECIMAL(10, 8),
  longitude = ST_X(cp.centroid)::DECIMAL(11, 8),
  centroid = cp.centroid,
  updated_at = now()
FROM cadastre_parcels_cl cp
WHERE sr.rol = cp.rol
  AND sr.comuna_id = cp.comuna_id
  AND cp.centroid IS NOT NULL
  AND sr.centroid IS NULL;

COMMIT;
