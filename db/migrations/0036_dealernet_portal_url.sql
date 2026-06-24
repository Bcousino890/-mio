-- 0036 · Añadir portal_url y notes a dealernet_contacts_cl
-- Permite asociar un contacto obtenido con la URL del portal inmobiliario
-- (Portalinmobiliario, fotocasa, etc.) desde donde se originó la búsqueda,
-- y notas libres del agente.

ALTER TABLE dealernet_contacts_cl
  ADD COLUMN IF NOT EXISTS portal_url  text,
  ADD COLUMN IF NOT EXISTS notes       text;

CREATE INDEX IF NOT EXISTS idx_dealernet_contacts_cl_portal_url
  ON dealernet_contacts_cl (portal_url)
  WHERE portal_url IS NOT NULL;
