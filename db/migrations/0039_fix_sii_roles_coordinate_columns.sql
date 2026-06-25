-- 0039_fix_sii_roles_coordinate_columns.sql
-- Add lat/lng columns to sii_roles_cl (API expects these names)
-- Copy from latitude/longitude if they exist

BEGIN;

-- Add lat/lng columns if they don't exist
ALTER TABLE sii_roles_cl
ADD COLUMN IF NOT EXISTS lat DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS lng DECIMAL(11, 8);

-- Populate lat/lng from latitude/longitude if lat is NULL but latitude exists
UPDATE sii_roles_cl
SET
  lat = latitude,
  lng = longitude
WHERE lat IS NULL AND latitude IS NOT NULL;

COMMIT;
