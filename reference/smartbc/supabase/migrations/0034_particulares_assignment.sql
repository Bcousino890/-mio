-- Asignación de particulares a un asesor para evitar trabajo duplicado:
-- en el panel se ve de un vistazo quién gestiona cada anuncio y quién lo
-- contactó por última vez (esto último ya vive en particulares_contacts).

ALTER TABLE particulares
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_particulares_assigned_to ON particulares(assigned_to);
