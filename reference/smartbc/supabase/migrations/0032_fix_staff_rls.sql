-- ============================================================
-- 0032: Fix staff RLS helper functions
-- Updates is_staff() and is_admin() to include owner and agent roles
-- This ensures session-based queries work for all staff roles
-- ============================================================

-- Update is_staff() to include owner and agent roles so they can
-- read client profiles, client_preferences, and other staff-visible data
CREATE OR REPLACE FUNCTION is_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role IN ('owner', 'admin', 'advisor', 'agent_admin', 'agent_senior', 'agent_junior')
  );
$$;

-- Update is_admin() to include owner and agent_admin roles
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role IN ('owner', 'admin', 'agent_admin')
  );
$$;
