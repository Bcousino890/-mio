-- ============================================================
-- SmartBC · Coordenadas geográficas cacheadas por propiedad
-- ============================================================
-- Para que el mapa del SmartLink muestre la ubicación lo más exacta
-- posible. Geocodificamos con OpenStreetMap (Nominatim) la primera
-- vez que se accede al SmartLink y cacheamos en BD para siempre.
-- ============================================================

alter table properties
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists geocoded_at timestamptz;

-- Índice solo sobre propiedades que tengan coordenadas (para queries
-- futuras tipo "propiedades cerca de…").
create index if not exists idx_properties_geo
  on properties(latitude, longitude)
  where latitude is not null and longitude is not null;
