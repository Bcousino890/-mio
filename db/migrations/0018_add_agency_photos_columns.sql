-- Migration: 0018_add_agency_photos_columns.sql
-- Add columns to support scraping photos from CRM agencies (Mobilia, Inmoweb, Level, etc)

BEGIN;

-- Add columns for storing photos from agency CRM platforms
ALTER TABLE listings
ADD COLUMN IF NOT EXISTS agency_photos jsonb DEFAULT '[]',
ADD COLUMN IF NOT EXISTS photo_source_status text DEFAULT 'unknown' CHECK (photo_source_status IN ('idealista_only', 'agency_only', 'both', 'failed', 'unknown')),
ADD COLUMN IF NOT EXISTS agency_photo_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS agency_photos_fetched_at timestamptz;

-- Index for filtering by photo source status
CREATE INDEX IF NOT EXISTS idx_listings_photo_source_status
ON listings(photo_source_status)
WHERE is_active = true;

COMMIT;
