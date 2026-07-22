-- ─────────────────────────────────────────────────────────────────────────────
-- 0067 · media_assets_cl: fotos deduplicadas por contenido (plan Anuncios CL · H7)
-- ─────────────────────────────────────────────────────────────────────────────
-- Requisito del usuario: si la misma corredora re-publica las mismas fotos, NO
-- guardarlas dos veces. Mismo mecanismo de direccionamiento por contenido que
-- listing_snapshots_cl/snapshot_blobs_cl (0066), aplicado a fotos:
--
--   content_hash — sha256 de los BYTES de la imagen (dedup exacto: la misma
--     foto descargada dos veces, byte a byte, es una sola fila).
--   phash        — dHash perceptual (scraper/lib/phash.mjs, ya existente) para
--     detectar la MISMA foto recomprimida/reescalada por el CDN de una
--     corredora vs otra (bytes distintos, imagen igual) vía la función SQL
--     hamming_distance() ya definida en 0014_dedup_scoring.sql — se reutiliza
--     tal cual, no se reimplementa.
--
-- Sin índice de proximidad para phash (ej. VP-tree/LSH): el resto del repo
-- tampoco lo tiene para cover_phash (listings_cl, 0028) — un índice btree
-- normal + scan acotado por LIMIT es consistente con ese precedente. Si el
-- volumen lo justifica más adelante, es una optimización de índice aislada,
-- no un cambio de esquema.

CREATE TABLE IF NOT EXISTS media_assets_cl (
  content_hash   text PRIMARY KEY,        -- sha256 hex de los bytes de la imagen
  phash          text,                    -- dHash perceptual (phash.mjs), 16 hex chars
  bucket_url     text NOT NULL,           -- URL pública en Hetzner Object Storage
  bytes          integer,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  -- Cuántos listings_cl.stored_photos referencian este mismo content_hash —
  -- crece cada vez que una corredora (u otra) re-publica exactamente la misma
  -- foto; nunca se re-sube ni se re-descarga cuando esto pasa.
  ref_count      integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_media_assets_cl_phash
  ON media_assets_cl(phash) WHERE phash IS NOT NULL;
