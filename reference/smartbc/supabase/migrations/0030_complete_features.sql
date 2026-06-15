-- ============================================================
-- 0030: Complete features — calendar, password reset, team reads
-- Consolidates 4 features into a single migration (0030_calendar_assigned_to.sql,
-- 0030_calendar_events.sql, 0030_password_reset_fix.sql, 0030_team_reads.sql)
-- ============================================================

-- 1. Add assigned_to to visit_requests
ALTER TABLE visit_requests ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- 2. Create calendar_events table
CREATE TABLE IF NOT EXISTS calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES profiles(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(title) > 0 AND char_length(title) <= 500),
  description text,
  event_type text NOT NULL DEFAULT 'meeting'
    CHECK (event_type IN ('meeting', 'call', 'task', 'visit', 'other')),
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  client_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  google_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_created_by ON calendar_events(created_by, start_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_assigned_to ON calendar_events(assigned_to, start_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start_at ON calendar_events(start_at);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- Calendar events policies
CREATE POLICY IF NOT EXISTS "calendar_events_participant_select" ON calendar_events
  FOR SELECT
  USING (
    auth.uid() = created_by
    OR auth.uid() = assigned_to
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY IF NOT EXISTS "calendar_events_creator_insert" ON calendar_events
  FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY IF NOT EXISTS "calendar_events_creator_update" ON calendar_events
  FOR UPDATE
  USING (
    auth.uid() = created_by
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY IF NOT EXISTS "calendar_events_creator_delete" ON calendar_events
  FOR DELETE
  USING (
    auth.uid() = created_by
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- 3. Add password reset token policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'password_reset_tokens'
      AND policyname = 'password_reset_tokens_service_insert'
  ) THEN
    CREATE POLICY "password_reset_tokens_service_insert"
      ON password_reset_tokens FOR INSERT
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'password_reset_tokens'
      AND policyname = 'password_reset_tokens_service_update'
  ) THEN
    CREATE POLICY "password_reset_tokens_service_update"
      ON password_reset_tokens FOR UPDATE
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'password_reset_tokens'
      AND policyname = 'password_reset_tokens_service_select'
  ) THEN
    CREATE POLICY "password_reset_tokens_service_select"
      ON password_reset_tokens FOR SELECT
      USING (true);
  END IF;
END $$;

-- Password reset cleanup function
CREATE OR REPLACE FUNCTION cleanup_password_reset_tokens()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM password_reset_tokens
  WHERE expires_at < now() OR used_at IS NOT NULL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- 4. Create team conversation reads table
CREATE TABLE IF NOT EXISTS team_conversation_reads (
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES team_direct_conversations(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS team_conversation_reads_user_idx
  ON team_conversation_reads(user_id);
