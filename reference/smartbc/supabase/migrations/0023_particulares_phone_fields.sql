-- Add phone extraction metadata and manual verification fields
ALTER TABLE particulares
  ADD COLUMN IF NOT EXISTS phone_extraction_confidence FLOAT,
  ADD COLUMN IF NOT EXISTS phone_manually_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMP;

-- Create index for quick lookups
CREATE INDEX IF NOT EXISTS idx_particulares_phone_verified ON particulares(phone_manually_verified);
