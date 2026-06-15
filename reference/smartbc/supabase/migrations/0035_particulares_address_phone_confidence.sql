-- Dirección exacta del anuncio (calle y número cuando Idealista la expone).
-- El scraper ya la extrae (listing.address) pero hasta ahora no se guardaba:
-- solo teníamos `zone` (distrito/municipio), demasiado impreciso para captar.
ALTER TABLE particulares
  ADD COLUMN IF NOT EXISTS address TEXT;

-- Confianza de la extracción del teléfono ('high' = atributo de datos /
-- API, 'medium' = tel: links o patrones en scripts). Permite distinguir en
-- el panel los teléfonos fiables de los dudosos.
ALTER TABLE particulares
  ADD COLUMN IF NOT EXISTS phone_confidence TEXT
  CHECK (phone_confidence IN ('high', 'medium', 'low') OR phone_confidence IS NULL);
