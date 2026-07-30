-- Cuántas fotos declara el portal para cada anuncio.
--
-- El parser ya lo extraía (`media_counters` del blob: "2 Fotos", count: 2) y lo
-- devolvía como `photos_total_count`, pero nadie lo guardaba: se calculaba y se
-- tiraba en el mismo request. Sin ese número no hay forma de responder a la
-- única pregunta que importa aquí — "¿a esta ficha le faltan fotos?" —, porque
-- 3 fotos guardadas puede ser correcto (el aviso tiene 3) o un fallo (el aviso
-- tiene 24 y la galería vino a medias). Contar solo las guardadas no distingue
-- los dos casos, y por eso el criterio de re-scrapeo tenía que inventarse
-- umbrales tipo "5 o menos" que no significan nada.
--
-- Con esta columna la comprobación es exacta y converge:
--   guardadas < declaradas  →  a la ficha le faltan fotos, se vuelve a bajar
--   guardadas = declaradas  →  está completa, no se toca

ALTER TABLE listings_cl ADD COLUMN IF NOT EXISTS photos_total_count integer;

COMMENT ON COLUMN listings_cl.photos_total_count IS
  'Fotos que el portal declara para el aviso (media_counters). NULL = el anuncio se scrapeó antes de guardarlo.';
