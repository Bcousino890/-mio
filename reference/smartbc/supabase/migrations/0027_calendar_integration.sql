-- Tokens de integración Google
-- Setup Google Calendar:
-- 1. Ve a console.cloud.google.com
-- 2. Crea proyecto "SmartBC CRM"
-- 3. Habilita "Google Calendar API"
-- 4. Ve a Credenciales → OAuth 2.0 → Crear credenciales
-- 5. Tipo: Aplicación Web
-- 6. URI de redirección: https://portal.bcousinoprop.com/api/integrations/google/callback
-- 7. Copia Client ID y Client Secret
-- 8. Agrega en .env del VPS:
--    GOOGLE_CLIENT_ID=xxx
--    GOOGLE_CLIENT_SECRET=xxx
--    GOOGLE_REDIRECT_URI=https://portal.bcousinoprop.com/api/integrations/google/callback

CREATE TABLE IF NOT EXISTS google_calendar_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  access_token TEXT,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMPTZ,
  calendar_id TEXT DEFAULT 'primary',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vincular eventos de Calendar a visitas
ALTER TABLE visit_requests ADD COLUMN IF NOT EXISTS google_event_id TEXT;
ALTER TABLE visit_requests ADD COLUMN IF NOT EXISTS calendar_synced_at TIMESTAMPTZ;

-- RLS
ALTER TABLE google_calendar_tokens ENABLE ROW LEVEL SECURITY;

-- Solo el propio usuario (admin/advisor) puede leer/escribir sus tokens
CREATE POLICY "calendar_tokens_owner" ON google_calendar_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
