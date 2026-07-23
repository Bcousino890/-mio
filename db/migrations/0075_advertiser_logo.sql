-- ─────────────────────────────────────────────────────────────────────────────
-- 0075 · logo de la corredora: persistir lo que parseDetailPage ya extrae
-- ─────────────────────────────────────────────────────────────────────────────
-- parseDetailPage (parse-portalinmobiliario.mjs) extrae `advertiser_logo` (URL
-- del logo de tienda oficial, ambos formatos de host de ML: classifieds_accounts
-- y vis-accounts) desde hace varios commits, pero nunca se persistía en ningún
-- lado — ni columna en listings_cl ni en corredoras_cl. La señal se calculaba y
-- se descartaba en el mismo request, igual que pasó con has_video/video_modal_url
-- (0074) antes de arreglarlo.
--
-- Dos columnas, un dato por dos motivos distintos:
--   - listings_cl.advertiser_logo: el logo tal como lo vio ESTE anuncio (puede
--     variar entre corridas si la corredora lo cambia).
--   - corredoras_cl.logo_url: el logo CANÓNICO de la corredora consolidada
--     (advertiser_id), el que se muestra en el directorio y la ficha — lo llena
--     runCorredoraConsolidationCl() (dedup-cl.mjs) tomando el más reciente no
--     nulo entre sus listings, igual que ya hace con el nombre.

ALTER TABLE listings_cl
  ADD COLUMN IF NOT EXISTS advertiser_logo text;

ALTER TABLE corredoras_cl
  ADD COLUMN IF NOT EXISTS logo_url text;
