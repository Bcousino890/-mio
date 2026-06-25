-- Verify coordinates are properly loaded in sii_roles_cl
SELECT
  'Las Condes' as comuna,
  COUNT(*) as total_roles,
  COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) as roles_con_coords,
  ROUND(100.0 * COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) / COUNT(*), 1) as percent_with_coords
FROM sii_roles_cl
WHERE sii_comuna_code = '15108'

UNION ALL

SELECT
  'Vitacura' as comuna,
  COUNT(*) as total_roles,
  COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) as roles_con_coords,
  ROUND(100.0 * COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) / COUNT(*), 1) as percent_with_coords
FROM sii_roles_cl
WHERE sii_comuna_code = '15160'

UNION ALL

SELECT
  'Lo Barnechea' as comuna,
  COUNT(*) as total_roles,
  COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) as roles_con_coords,
  ROUND(100.0 * COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) / COUNT(*), 1) as percent_with_coords
FROM sii_roles_cl
WHERE sii_comuna_code = '15161'

UNION ALL

SELECT
  'Colina' as comuna,
  COUNT(*) as total_roles,
  COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) as roles_con_coords,
  ROUND(100.0 * COUNT(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) / COUNT(*), 1) as percent_with_coords
FROM sii_roles_cl
WHERE sii_comuna_code = '14201';
