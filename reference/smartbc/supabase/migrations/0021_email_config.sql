-- ============================================================
-- SmartBC · Email Configuration
-- ============================================================
-- Stores encrypted SMTP credentials for Ferozo email service
-- ============================================================

CREATE TABLE IF NOT EXISTS email_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  smtp_server text NOT NULL,
  smtp_port integer NOT NULL,
  smtp_user text NOT NULL,
  smtp_password_encrypted text NOT NULL,
  smtp_password_iv text NOT NULL,
  use_ssl boolean NOT NULL DEFAULT true,
  from_email text NOT NULL,
  from_name text DEFAULT 'SmartBC',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Only one config record should exist
CREATE UNIQUE INDEX idx_email_config_singleton ON email_config (id) WHERE id IS NOT NULL;

ALTER TABLE email_config ENABLE ROW LEVEL SECURITY;

-- Only admins can manage email config
CREATE POLICY "email_config_admin_all"
  ON email_config FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Create trigger for updated_at
CREATE TRIGGER email_config_updated_at
  BEFORE UPDATE ON email_config
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Table to track password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX idx_password_reset_tokens_expires ON password_reset_tokens(expires_at) WHERE used_at IS NULL;

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Users can view their own tokens; admins can manage all
CREATE POLICY "password_reset_tokens_self_select"
  ON password_reset_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "password_reset_tokens_admin_all"
  ON password_reset_tokens FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());
