-- Cuándo se bajó y parseó ENTERA cada ficha, para poder rotar el re-scrapeo.
--
-- El re-scrapeo de fichas viejas (queue-maintenance-cl.mjs) elegía por
-- "tiene 5 fotos o menos", que era el rastro del parser antiguo. El criterio
-- funciona para el backfill pero NO CONVERGE: un anuncio que de verdad tiene 3
-- fotos lo cumple para siempre, así que volvía a la cola cada media hora. En la
-- muestra de producción son ~6% del catálogo (74 de 1.200 con 1-4 fotos):
-- ~960 anuncios re-scrapeándose en bucle, ~19.000 descargas al día que no
-- aportan nada, gastando GB del proxy residencial y dando motivos al portal
-- para volver a bloquear la IP (ya devolvió 403 una vez).
--
-- Con esta columna el criterio pasa a ser "la ficha que lleva más tiempo sin
-- bajarse", que sí converge: al re-scrapear se actualiza la fecha y el anuncio
-- se va al final de la cola. Los del parser antiguo entran primero (NULL) y
-- después el catálogo rota entero a ritmo acotado, que de paso es lo único que
-- detecta bajadas de precio en anuncios ya guardados.
--
-- No sirve last_seen_at para esto: lo mueve también el barrido del listado, que
-- ve el anuncio sin abrir su ficha.

ALTER TABLE listings_cl ADD COLUMN IF NOT EXISTS detail_parsed_at timestamptz;

COMMENT ON COLUMN listings_cl.detail_parsed_at IS
  'Última vez que se descargó y parseó la ficha completa (no el listado). NULL = nunca con el parser actual.';

-- Índice para el ORDER BY del re-scrapeo: los NULL primero (fichas del parser
-- viejo), después las más antiguas. Solo cubre lo publicado, que es lo único
-- que se re-scrapea.
CREATE INDEX IF NOT EXISTS idx_listings_cl_detail_parsed_at
  ON listings_cl (detail_parsed_at NULLS FIRST)
  WHERE is_active;
