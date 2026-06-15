-- Add advertiser type tracking for particulares detection

CREATE TABLE IF NOT EXISTS particulares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal TEXT NOT NULL CHECK (portal IN ('idealista', 'fotocasa', 'kelify')),
  external_id TEXT UNIQUE NOT NULL,
  source_url TEXT NOT NULL,
  owner_name TEXT,
  phone TEXT,
  email TEXT,
  chat_only BOOLEAN DEFAULT FALSE,
  zone TEXT,
  subzone TEXT,
  price INTEGER,
  operation TEXT CHECK (operation IN ('rent', 'sale')),
  bedrooms INTEGER,
  bathrooms INTEGER,
  square_meters INTEGER,
  description TEXT,
  features JSONB,
  photos JSONB,
  advertiser_type TEXT CHECK (advertiser_type IN ('particular', 'professional', 'unknown')) DEFAULT 'unknown',
  is_ad_professional BOOLEAN,
  detected_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_particulares_advertiser_type ON particulares(advertiser_type);
CREATE INDEX idx_particulares_portal_type ON particulares(portal, advertiser_type);
CREATE INDEX idx_particulares_zone ON particulares(zone);
CREATE INDEX idx_particulares_operation ON particulares(operation);
CREATE INDEX idx_particulares_created_at ON particulares(created_at DESC);

-- Track changes to particulares
CREATE TABLE IF NOT EXISTS particulares_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  particular_id UUID NOT NULL REFERENCES particulares(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('price_change', 'photo_added', 'description_updated', 'deleted', 'reactivated')),
  old_value JSONB,
  new_value JSONB,
  changed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_particulares_changes_particular_id ON particulares_changes(particular_id);
CREATE INDEX idx_particulares_changes_type ON particulares_changes(change_type);
