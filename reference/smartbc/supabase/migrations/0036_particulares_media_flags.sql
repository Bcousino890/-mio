-- Plano y vídeo de los anuncios de particulares.
-- El scraper detecta si la ficha de Idealista incluye plano (imagen con
-- alt/title "Plano…" o tag "plan" en multimedia) y/o vídeo (<video><source>),
-- y guarda la URL para mostrarlos en el CRM.
ALTER TABLE particulares ADD COLUMN IF NOT EXISTS has_floor_plan BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE particulares ADD COLUMN IF NOT EXISTS floor_plan_url TEXT;
ALTER TABLE particulares ADD COLUMN IF NOT EXISTS has_video BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE particulares ADD COLUMN IF NOT EXISTS video_url TEXT;
