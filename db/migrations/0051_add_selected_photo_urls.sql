-- 0051 · selected_photo_urls — fotos elegidas por el usuario para la verificación visual IA
-- Las corredoras ordenan las fotos de forma inconsistente; el usuario selecciona
-- manualmente cuáles enviar al modelo de visión (fachada, piscina, techo, jardín)
-- en lugar de las 4 primeras al azar. Array JSON de URLs, subconjunto de photos.

ALTER TABLE captaciones_cl
ADD COLUMN IF NOT EXISTS selected_photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb;
