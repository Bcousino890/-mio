-- ─────────────────────────────────────────────────────────────────────────────
-- 0004 · Inmueble físico (property) + anuncios de mercado (listings)
-- ─────────────────────────────────────────────────────────────────────────────
-- DOS CAPAS:
--   listings  = capa CRUDA. Un anuncio por portal (mismo piso en Idealista +
--               Fotocasa = 2 filas). TODO el mercado: particular Y profesional.
--   property  = capa DEDUPLICADA. Un inmueble físico = una fila. Agrupa los N
--               anuncios que son EL MISMO piso.
--
-- DEDUPLICACIÓN POR MATCHING (no por catastro): se agrupan anuncios duplicados
-- comparando ubicación + m² + habitaciones + tipo + precio + fotos (phash) +
-- texto. Ver 0008_dedup_matching.sql. La Referencia Catastral (RC14/RC20) NO es
-- la clave de dedup: es un ENRIQUECIMIENTO OPCIONAL y BAJO DEMANDA por anuncio
-- ("¿quieres la dirección exacta?"). Ver 0009_rc_resolution.sql.

-- ─── property (inmueble físico deduplicado) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS property (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Atributos canónicos (consolidados de los anuncios agrupados)
  operation            text CHECK (operation IN ('sale','rent')),
  property_type        text,
  canonical_price      integer,        -- precio representativo (p.ej. mínimo vigente)
  square_meters        integer,
  bedrooms             integer,
  bathrooms            integer,

  zone_id              uuid REFERENCES zones(id) ON DELETE SET NULL,
  latitude             numeric,
  longitude            numeric,
  geom                 geometry(Point, 4326) GENERATED ALWAYS AS (
                         CASE WHEN longitude IS NOT NULL AND latitude IS NOT NULL
                              THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
                              ELSE NULL END
                       ) STORED,

  -- Resumen del grupo de anuncios
  listing_count        integer NOT NULL DEFAULT 0,
  portals              text[]  NOT NULL DEFAULT '{}',     -- fuentes donde aparece (portales/agencias/webs)
  source_types         text[]  NOT NULL DEFAULT '{}',     -- {portal, agency_web, own_web, external_web}
  advertiser_kinds     text[]  NOT NULL DEFAULT '{}',     -- {particular}, {professional}, o ambos
  is_active            boolean NOT NULL DEFAULT true,      -- algún anuncio activo
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),

  -- Referencia catastral OPCIONAL / BAJO DEMANDA (no es clave de dedup)
  rc14                 char(14),
  rc20                 char(20),
  rc_status            text NOT NULL DEFAULT 'none' CHECK (rc_status IN ('none','rc14','rc20')),
  rc_confidence        numeric,
  exact_address        text,           -- dirección exacta (solo cuando se resuelve RC)

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_zone   ON property(zone_id);
CREATE INDEX IF NOT EXISTS idx_property_geom   ON property USING gist(geom);
CREATE INDEX IF NOT EXISTS idx_property_active ON property(is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_property_rc14   ON property(rc14) WHERE rc14 IS NOT NULL;

-- ─── listings (anuncios crudos, todo portal y todo tipo de anunciante) ───────
CREATE TABLE IF NOT EXISTS listings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- "fuente" = CUALQUIER origen: portal, web de agencia, web propia, web externa.
  -- El matching (0008) agrupa el mismo piso venga de la fuente que venga.
  portal             text NOT NULL,                 -- id de la fuente: idealista | fotocasa | web:remax-centro.es | own | ...
  source_type        text NOT NULL DEFAULT 'portal'
                       CHECK (source_type IN ('portal','agency_web','own_web','external_web')),
  external_id        text NOT NULL,                 -- id del anuncio en la fuente
  source_url         text NOT NULL,

  -- Grupo de dedup (lo asigna el matcher; NULL hasta agrupar)
  property_id        uuid REFERENCES property(id) ON DELETE SET NULL,
  match_confidence   numeric,                        -- 0..1 confianza de pertenencia al grupo

  operation          text CHECK (operation IN ('sale','rent')),
  advertiser_type    text NOT NULL DEFAULT 'unknown'
                       CHECK (advertiser_type IN ('particular','professional','unknown')),
  is_ad_professional boolean,
  advertiser_name    text,                          -- agencia/profesional (para exclusivas rotas)
  contact_name       text,                          -- nombre del particular
  phone              text,                          -- +34XXXXXXXXX
  phone_confidence   text CHECK (phone_confidence IN ('high','medium','low')),

  price              integer,
  bedrooms           integer,
  bathrooms          integer,
  square_meters      integer,
  property_type      text,

  zone_id            uuid REFERENCES zones(id) ON DELETE SET NULL,
  zone_raw           text,                          -- zona tal cual vino del scraper
  subzone_raw        text,
  address            text,
  latitude           numeric,
  longitude          numeric,
  blur_radius_m      integer,                       -- radio del círculo difuso (Idealista)
  geom               geometry(Point, 4326) GENERATED ALWAYS AS (
                       CASE WHEN longitude IS NOT NULL AND latitude IS NOT NULL
                            THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
                            ELSE NULL END
                     ) STORED,

  description        text,
  features           jsonb,
  photos             jsonb,
  -- Huellas perceptuales de fotos para el matching de duplicados (sin IA)
  cover_phash        text,
  photo_phashes      text[] NOT NULL DEFAULT '{}',
  floor_plan_url     text,
  video_url          text,
  energy_rating      text,

  -- Referencia catastral OPCIONAL / BAJO DEMANDA (no es clave de dedup)
  rc14               char(14),
  rc20               char(20),
  rc_status          text NOT NULL DEFAULT 'none' CHECK (rc_status IN ('none','rc14','rc20')),
  rc_confidence      numeric,

  -- Estado / ciclo de vida (RETENCIÓN: nunca se borra)
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','gone')),
  is_active          boolean NOT NULL DEFAULT true,
  detected_at        timestamptz NOT NULL DEFAULT now(),
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  taken_down_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (portal, external_id)
);

CREATE INDEX IF NOT EXISTS idx_listings_geom        ON listings USING gist(geom);
CREATE INDEX IF NOT EXISTS idx_listings_property    ON listings(property_id);
CREATE INDEX IF NOT EXISTS idx_listings_zone        ON listings(zone_id);
CREATE INDEX IF NOT EXISTS idx_listings_advertiser  ON listings(advertiser_type);
CREATE INDEX IF NOT EXISTS idx_listings_operation   ON listings(operation);
CREATE INDEX IF NOT EXISTS idx_listings_active      ON listings(is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_listings_portal      ON listings(portal);
CREATE INDEX IF NOT EXISTS idx_listings_source_type ON listings(source_type);
CREATE INDEX IF NOT EXISTS idx_listings_cover_phash ON listings(cover_phash) WHERE cover_phash IS NOT NULL;
-- Blocking del matcher: candidatos por zona+operación+habitaciones+m².
CREATE INDEX IF NOT EXISTS idx_listings_block
  ON listings(operation, bedrooms, square_meters) WHERE is_active;
-- Dedup por texto (fallback): trigram sobre descripción.
CREATE INDEX IF NOT EXISTS idx_listings_desc_trgm   ON listings USING gin(description gin_trgm_ops);
