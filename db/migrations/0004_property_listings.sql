-- ─────────────────────────────────────────────────────────────────────────────
-- 0004 · Inmueble canónico (property) + anuncios de mercado (listings)
-- ─────────────────────────────────────────────────────────────────────────────
-- DOS CAPAS:
--   listings  = capa CRUDA. Un anuncio por portal (mismo piso en Idealista +
--               Fotocasa = 2 filas). TODO el mercado: particular Y profesional.
--   property  = capa CANÓNICA. Un inmueble físico = una fila, identificado por
--               RC20. Las N apariciones (listings) del mismo piso apuntan aquí.
--
-- La deduplicación cross-portal se hace por RC20: cuando un listing resuelve a
-- un RC20, se busca/crea la property con ese RC20 y se enlaza. Mientras no haya
-- RC20, property_id queda NULL (anuncio sin resolver).

-- ─── property (inmueble canónico) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rc20                  char(20),                 -- clave canónica (única si no es NULL)
  rc14                  char(14),                 -- edificio (fallback si no hay RC20)
  resolution_status     text NOT NULL DEFAULT 'unresolved'
                          CHECK (resolution_status IN ('unresolved','rc14','rc20')),
  resolution_confidence numeric,                  -- 0..1
  property_type         text,
  address               text,                     -- dirección exacta (de RC14)
  latitude              numeric,
  longitude             numeric,
  geom                  geometry(Point, 4326) GENERATED ALWAYS AS (
                          CASE WHEN longitude IS NOT NULL AND latitude IS NOT NULL
                               THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
                               ELSE NULL END
                        ) STORED,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- RC20 único SOLO cuando existe (varias filas sin resolver pueden coexistir).
CREATE UNIQUE INDEX IF NOT EXISTS uq_property_rc20 ON property(rc20) WHERE rc20 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_property_rc14 ON property(rc14);
CREATE INDEX IF NOT EXISTS idx_property_geom ON property USING gist(geom);

-- ─── listings (anuncios crudos, todo portal y todo tipo de anunciante) ───────
CREATE TABLE IF NOT EXISTS listings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal             text NOT NULL,                 -- idealista | fotocasa | habitaclia | pisos | milanuncios | ...
  external_id        text NOT NULL,                 -- id del anuncio en el portal
  source_url         text NOT NULL,
  property_id        uuid REFERENCES property(id) ON DELETE SET NULL,

  operation          text CHECK (operation IN ('sale','rent')),
  advertiser_type    text NOT NULL DEFAULT 'unknown'
                       CHECK (advertiser_type IN ('particular','professional','unknown')),
  is_ad_professional boolean,
  advertiser_name    text,                          -- nombre de agencia/profesional (para exclusivas rotas)
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
  floor_plan_url     text,
  video_url          text,
  energy_rating      text,

  -- Resultado del motor RC sobre este anuncio
  rc14               char(14),
  rc20               char(20),
  resolution_confidence numeric,

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
CREATE INDEX IF NOT EXISTS idx_listings_rc20        ON listings(rc20)        WHERE rc20 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_rc14        ON listings(rc14)        WHERE rc14 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_property    ON listings(property_id);
CREATE INDEX IF NOT EXISTS idx_listings_zone        ON listings(zone_id);
CREATE INDEX IF NOT EXISTS idx_listings_advertiser  ON listings(advertiser_type);
CREATE INDEX IF NOT EXISTS idx_listings_operation   ON listings(operation);
CREATE INDEX IF NOT EXISTS idx_listings_active      ON listings(is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_listings_portal      ON listings(portal);
-- Fallback de dedup por texto (cuando no hay RC): trigram sobre descripción.
CREATE INDEX IF NOT EXISTS idx_listings_desc_trgm   ON listings USING gin(description gin_trgm_ops);

