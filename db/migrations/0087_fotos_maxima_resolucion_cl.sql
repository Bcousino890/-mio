-- Arregla las fotos YA guardadas: quita las que no son del anuncio y sube las
-- demás a la variante de máxima resolución.
--
-- Dos cosas que el arreglo del parser solo corrige de aquí en adelante. Sin
-- este backfill habría que esperar a que la rotación de re-scrapeo pase por las
-- ~16.000 fichas (casi un día) para ver el cambio, y son transformaciones de
-- texto puro: no hace falta volver a bajar nada del portal.
--
-- 1. Gráficos de la interfaz colados como fotos.
--    Verificado en producción: MLC-4021070764 guardaba 3 "fotos" y dos eran
--    frontend-assets/vis-transactions-frontend/{big,little}-empty-state.webp
--    — los placeholders de "aquí no hay nada" de la galería de Mercado Libre.
--    La ficha mostraba 3 imágenes y solo 1 era la casa. Toda foto subida por el
--    vendedor lleva el id {secuencia}-MLC{item}; un recurso de la web, no.
--
-- 2. Las fotos a partir de la sexta se guardaban en media resolución.
--    La letra que va tras el id de la foto es el código de tamaño. Medido
--    contra el CDN con la MISMA imagen (692866-MLC110477947669_042026):
--
--        -F → 800x597 px · 122.848 bytes   ← el mayor que sirve
--        -B → 800x597 px · 120.756 bytes
--        -L → 640x478 px ·  80.754 bytes
--        -O → 500x373 px ·  52.996 bytes
--        -V → 320x239 px ·  24.178 bytes
--
--    El blob de la ficha trae las primeras fotos en -F, pero la galería por
--    item_id las construía en -O. De ahí que las primeras se vieran bien y el
--    resto peor: no era el anuncio, era la plantilla con la que las pedíamos.
--    Comprobado que la variante -F existe también para las formas D_… y
--    D_NQ_NP_2X_… (HTTP 200, mismos 122.848 bytes).
--
-- Se conserva el orden original de las fotos (WITH ORDINALITY) y solo se tocan
-- las filas que de verdad tienen algo que corregir.

UPDATE listings_cl l
SET photos = COALESCE((
      SELECT jsonb_agg(
               regexp_replace(t.u, '(D_(NQ_NP_)?(2X_)?[0-9]+-MLC[0-9]+(_[0-9]+)?)-[A-Z]([-.])', '\1-F\5')
               ORDER BY t.ord
             )
      FROM jsonb_array_elements_text(l.photos) WITH ORDINALITY AS t(u, ord)
      WHERE t.u ~ '[0-9]+-MLC[0-9]+'   -- descarta lo que no es foto del anuncio
    ), '[]'::jsonb)
WHERE jsonb_typeof(l.photos) = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(l.photos) AS t(u)
    WHERE t.u !~ '[0-9]+-MLC[0-9]+'                                                    -- gráfico de la interfaz
       OR t.u ~ '(D_(NQ_NP_)?(2X_)?[0-9]+-MLC[0-9]+(_[0-9]+)?)-[A-EG-Z][-.]'           -- tamaño menor que F
  );
