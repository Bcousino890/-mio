-- Coordenadas geográficas del anuncio de particular (latitud/longitud).
-- Las rellena el scraper al extraer la ficha de Idealista y se usan para
-- mostrar el mapa en el modal de detalle de /admin/particulares.
ALTER TABLE particulares
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;
