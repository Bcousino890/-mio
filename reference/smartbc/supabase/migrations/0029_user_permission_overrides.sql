-- Per-user permission overrides (on top of role defaults)
CREATE TABLE user_permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  resource text NOT NULL,  -- e.g. "properties", "particulares", "clientes", "reportes", "usuarios", "configuracion", "mensajes"
  action text NOT NULL,    -- "view", "edit", "create", "delete", "export"
  allowed boolean NOT NULL,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, resource, action)
);
CREATE INDEX ON user_permission_overrides(user_id);
