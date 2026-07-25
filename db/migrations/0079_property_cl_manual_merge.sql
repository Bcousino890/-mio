-- ─────────────────────────────────────────────────────────────────────────────
-- 0079 · Matching MANUAL de propiedades: unir a mano N property_cl en una sola
--        (y poder separar lo que quedó mal unido)
-- ─────────────────────────────────────────────────────────────────────────────
-- El dedup automático (Nivel 1 determinista + Nivel 2 probabilístico, ver 0064)
-- nunca va a acertar el 100%: dos corredoras publican el MISMO inmueble con m²
-- distintos, fotos distintas y el pin a media cuadra, y el score se queda corto
-- → quedan 2 fichas para 1 propiedad. El equipo, mirando las fotos, lo ve al
-- instante. Esta migración soporta esa corrección a mano ("arrastro una ficha
-- sobre la otra / selecciono y uno" — ahí no hay fallo), con dos garantías:
--
--   1) TRAZABILIDAD: cada unión/separación queda registrada en
--      `property_merge_log_cl` con los listings movidos y de qué property_cl
--      venía cada uno, para poder auditarla y deshacerla.
--   2) PERMANENCIA: la decisión humana no se puede "des-hacer" sola en el
--      próximo barrido del dedup automático. Dos mecanismos:
--        · `listings_cl.manual_property_lock` — el anuncio quedó asignado a
--          mano; Nivel 1 (dedup-cl.mjs) deja de reasignarlo por property_code.
--        · pares en `listing_match_cl` con `decided_by='human'` — la unión
--          inserta aristas `confirmed` (score 1) para que Nivel 2
--          (clustering-cl.mjs) mantenga el grupo; la separación inserta
--          aristas `rejected` para que no lo vuelva a fusionar.
--
-- No se agrega ningún estado nuevo al modelo: se reusan `listing_match_cl`
-- (que ya contempla `decided_by='human'` desde 0028) y el vínculo
-- `listings_cl.property_cl_id` de 0064.

-- ─── Anuncios asignados a mano ───────────────────────────────────────────────
-- Marca el anuncio como "movido por una persona". El dedup Nivel 1 agrupa por
-- (property_code, advertiser_id) y REASIGNA la familia completa a un mismo
-- property_cl: sin este flag, separar a mano dos anuncios que comparten
-- property_code se revertía en el siguiente barrido.
ALTER TABLE listings_cl
  ADD COLUMN IF NOT EXISTS manual_property_lock boolean NOT NULL DEFAULT false;

-- ─── Propiedad canónica tocada a mano ────────────────────────────────────────
-- Sella el instante de la última unión/separación manual. La UI muestra el
-- distintivo "unido a mano" sobre la ficha para que nadie confunda un grupo
-- curado por el equipo con uno propuesto por el score.
ALTER TABLE property_cl
  ADD COLUMN IF NOT EXISTS manual_merge_at timestamptz;

-- ─── Bitácora de uniones/separaciones manuales ───────────────────────────────
-- Una fila por operación (no por anuncio). `moved` guarda el detalle anuncio a
-- anuncio incluyendo el property_cl de ORIGEN y su ref_code: la propiedad
-- absorbida se borra al unir (queda huérfana, misma política que
-- clustering-cl.mjs), así que el ref_code solo sobrevive aquí — sin él, el
-- historial diría "se unió algo" sin poder nombrar qué.
CREATE TABLE IF NOT EXISTS property_merge_log_cl (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action                text NOT NULL CHECK (action IN ('merge','split')),

  -- merge: la propiedad que SOBREVIVE. split: la propiedad de la que se sacan
  -- los anuncios (la que se queda con el resto).
  property_cl_id        uuid REFERENCES property_cl(id) ON DELETE SET NULL,
  property_ref_code     text,

  -- merge: las propiedades absorbidas (borradas al quedar sin anuncios).
  -- split: la propiedad NUEVA creada con los anuncios separados (un solo id).
  other_property_ids    uuid[] NOT NULL DEFAULT '{}',
  other_ref_codes       text[] NOT NULL DEFAULT '{}',

  -- [{listing_id, external_id, advertiser_name, from_property_cl_id,
  --   from_ref_code, prev_match_confidence}] — lo necesario para revertir.
  moved                 jsonb  NOT NULL DEFAULT '[]'::jsonb,
  listing_count         integer NOT NULL DEFAULT 0,

  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_merge_log_cl_property
  ON property_merge_log_cl(property_cl_id);
CREATE INDEX IF NOT EXISTS idx_property_merge_log_cl_created
  ON property_merge_log_cl(created_at DESC);
