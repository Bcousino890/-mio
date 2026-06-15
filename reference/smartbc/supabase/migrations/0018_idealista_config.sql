-- Stores Idealista API credentials for the partner integration
CREATE TABLE IF NOT EXISTS idealista_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_key text,
  client_id text,
  client_secret text,
  sandbox_mode boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE idealista_config ENABLE ROW LEVEL SECURITY;

-- Fix: usar is_admin() (auth.jwt()->>'role' no refleja el rol de la app en este
-- esquema). El acceso real va por service role. Idempotente.
DROP POLICY IF EXISTS "admin_manage_idealista_config" ON idealista_config;
CREATE POLICY "admin_manage_idealista_config"
  ON idealista_config FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());
