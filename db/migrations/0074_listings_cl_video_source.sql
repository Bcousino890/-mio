-- ─────────────────────────────────────────────────────────────────────────────
-- 0074 · listings_cl: persistir la señal de video que parseDetailPage YA extrae
-- ─────────────────────────────────────────────────────────────────────────────
-- parseDetailPage (parse-portalinmobiliario.mjs) extrae has_video (booleano) y
-- video_modal_url (endpoint /vis-modals/gallery/{id}?selected_tab=media_player)
-- desde el blob Nordic, pero upsert-listing-cl.mjs nunca los escribía en
-- listings_cl: la señal se calculaba y se descartaba en el mismo request. Solo
-- existía `stored_video` (0033), que se llena DESPUÉS de que media-sync-cl
-- descargue el archivo al bucket — sin la señal raw, la UI no podía ni mostrar
-- "tiene video" antes de esa sincronización.
--
-- Estas dos columnas guardan el dato crudo apenas se scrapea la ficha (igual
-- que photos antes de media-sync); stored_video sigue siendo la URL final en el
-- bucket una vez sincronizado.

ALTER TABLE listings_cl
  ADD COLUMN IF NOT EXISTS has_video       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS video_modal_url text; -- endpoint crudo del modal, previo a media-sync
