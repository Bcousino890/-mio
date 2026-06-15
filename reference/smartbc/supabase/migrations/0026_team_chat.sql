-- Canales de equipo
CREATE TABLE team_channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  emoji TEXT DEFAULT '💬',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mensajes de equipo
CREATE TABLE team_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id UUID REFERENCES team_channels(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  reply_to UUID REFERENCES team_messages(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON team_messages(channel_id, created_at DESC);

-- Habilitar realtime para mensajes
ALTER TABLE team_messages REPLICA IDENTITY FULL;

-- Seed canales iniciales
INSERT INTO team_channels (name, description, emoji) VALUES
  ('general', 'Comunicación general del equipo', '🏢'),
  ('visitas', 'Coordinar y confirmar visitas a propiedades', '🏠'),
  ('propiedades', 'Compartir fichas y buscar inmuebles para clientes', '📋'),
  ('ofertas', 'Negociaciones activas y seguimiento de ofertas', '💰');
