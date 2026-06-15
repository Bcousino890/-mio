-- Arregla las fotos DUPLICADAS al importar por link: en la galería cada foto
-- salía dos veces seguidas (pos0,pos0,pos1,pos1…). Causa: una re-importación con
-- doble submit / carrera (delete + insert concurrentes) dejaba 2 filas por
-- posición en property_photos.
--
-- NOTA: no añadimos un índice único (property_id, position) porque el reordenado
-- de fotos del admin actualiza posiciones una a una y chocaría transitoriamente.
-- La galería deduplica por url en el render (adapter + proxy /p), así que aunque
-- reaparecieran filas duplicadas, NUNCA se ven repetidas. Esta migración limpia
-- las que ya existían.

-- Conservar UNA fila por (property_id, position): la de menor id (la primera
-- creada). El resto se borran.
delete from property_photos a
using property_photos b
where a.property_id = b.property_id
  and a.position = b.position
  and a.id > b.id;
