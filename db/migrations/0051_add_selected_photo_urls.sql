-- Add selected_photo_urls column to captaciones table
-- Stores user-selected photo URLs as JSONB array for visual analysis with Gemini

ALTER TABLE captaciones
ADD COLUMN selected_photo_urls jsonb DEFAULT '[]'::jsonb;

CREATE INDEX idx_captaciones_selected_photo_urls
ON captaciones USING GIN (selected_photo_urls);
