-- Track CRM advisor interactions with particular owners
CREATE TABLE IF NOT EXISTS particulares_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  particular_id UUID NOT NULL REFERENCES particulares(id) ON DELETE CASCADE,
  advisor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL CHECK (contact_type IN ('call', 'whatsapp', 'email', 'visit', 'note')),
  outcome TEXT CHECK (outcome IN ('no_answer', 'interested', 'not_interested', 'callback_requested', 'appointment_set', 'converted', 'other')),
  notes TEXT,
  contacted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_particulares_contacts_particular ON particulares_contacts(particular_id);
CREATE INDEX IF NOT EXISTS idx_particulares_contacts_advisor ON particulares_contacts(advisor_id);
CREATE INDEX IF NOT EXISTS idx_particulares_contacts_contacted_at ON particulares_contacts(contacted_at DESC);

-- RLS: staff can read all, insert their own
ALTER TABLE particulares_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_read_contacts" ON particulares_contacts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('owner','admin','advisor','agent_admin','agent_senior','agent_junior')
    )
  );

CREATE POLICY "staff_insert_own_contacts" ON particulares_contacts
  FOR INSERT WITH CHECK (
    advisor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('owner','admin','advisor','agent_admin','agent_senior','agent_junior')
    )
  );
