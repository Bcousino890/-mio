-- Direct conversations between team members (canonical order: participant_a < participant_b)
CREATE TABLE team_direct_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_a uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  participant_b uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_message_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(participant_a, participant_b)
);

CREATE INDEX ON team_direct_conversations(participant_a);
CREATE INDEX ON team_direct_conversations(participant_b);

-- Messages inside direct conversations
CREATE TABLE team_direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES team_direct_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(content) > 0 AND char_length(content) <= 4000),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX ON team_direct_messages(conversation_id, created_at);
