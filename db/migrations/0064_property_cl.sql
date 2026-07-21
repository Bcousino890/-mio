-- ─────────────────────────────────────────────────────────────────────────────
-- 0064 · property_cl: inmueble físico canónico chileno (plan Anuncios CL · H3)
-- ─────────────────────────────────────────────────────────────────────────────
-- La capa que faltaba. Hoy la deduplicación chilena llega solo hasta PARES con
-- score (`listing_match_cl`, 0028) — no existe la fila "un inmueble físico"
-- equivalente a `property`/0004 en España. Esta tabla la crea, con el sufijo
-- `_cl` y las tres diferencias chilenas ya documentadas en 0028:
--   1) comuna (chile_comunas) en vez de zone/barrio español.
--   2) Moneda dual UF/CLP (no existe la UF en España).
--   3) `location_confidence` de 4 niveles en vez de `rc_status` binario — el
--      pin declarado por el vendedor NO es confiable per se en Chile.
--
-- CÓMO SE PUEBLA (dedup 2 niveles, ver docs/PLAN-ANUNCIOS-CL.md §2):
--   · Nivel 1 (determinista): todos los listings_cl con el mismo `property_code`
--     (+ `advertiser_id`) son la misma propiedad de la misma corredora → un
--     property_cl directo, sin score.
--   · Nivel 2 (probabilístico): el job de clustering (clustering-cl.mjs, patrón
--     de clustering.mjs) toma los pares `listing_match_cl.status='confirmed'`,
--     saca componentes conexos (graphology) y consolida cada componente en un
--     property_cl. Resuelve el caso de N corredoras distintas publicando el
--     mismo inmueble con su propio property_code cada una.
--
-- Los atributos "canónicos" se eligen por confianza dentro del grupo (ver
-- comentarios por campo): coords del listing con mayor location_confidence, m²
-- moda, precio mínimo vigente como "precio de mercado". La consolidación real la
-- hace el job; aquí solo se modela el destino.

CREATE TABLE IF NOT EXISTS property_cl (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Atributos canónicos (consolidados de los anuncios agrupados) ──────────
  operation            text CHECK (operation IN ('sale','rent')),
  property_type        text,

  -- Precio representativo. Se guarda en CLP (canonical) + la variante UF con su
  -- tasa/fecha, mismo criterio de moneda dual que listings_cl (0028): el
  -- "precio de mercado" es el mínimo vigente entre los anuncios del grupo.
  canonical_price      integer,                  -- CLP
  canonical_price_uf   numeric,                  -- UF (NULL si el ganador venía en CLP directo)
  uf_rate              numeric,                  -- CLP por 1 UF usada en la conversión
  uf_rate_date         date,                     -- fecha de la serie UF (mindicador.cl/BCCh)

  square_meters        integer,
  bedrooms             integer,
  bathrooms            integer,

  -- ── Ubicación (comuna, no zona española) ──────────────────────────────────
  comuna_id            uuid REFERENCES chile_comunas(id) ON DELETE SET NULL,
  localidad            text,                     -- sector/balneario dentro de la comuna
  latitude             numeric,                  -- del listing con mayor location_confidence
  longitude            numeric,
  geom                 geometry(Point, 4326) GENERATED ALWAYS AS (
                         CASE WHEN longitude IS NOT NULL AND latitude IS NOT NULL
                              THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
                              ELSE NULL END
                       ) STORED,
  exact_address        text,                     -- solo cuando la identidad se resolvió con confianza alta

  -- Mismo enum de 4 niveles que listings_cl / property_rc_cl. A nivel de
  -- propiedad canónica es la mejor confianza alcanzada por cualquiera de sus
  -- anuncios (o por la triangulación consolidada del grupo).
  location_confidence  text NOT NULL DEFAULT 'none'
                         CHECK (location_confidence IN ('none','candidate','pin_suspect','confirmed')),

  -- ── Rol SII (enlace catastral, se llena en Fase 7 · H11) ──────────────────
  -- Rol de avalúo confirmado para el inmueble canónico (no "candidate" como en
  -- listings_cl.rol_matriz_candidate: aquí es la resolución consolidada del
  -- grupo). La triangulación automática anuncio→Rol lo puebla al cerrar el
  -- círculo con el visor catastral. NULL hasta entonces.
  rol_matriz           text,
  rol_confidence       numeric,
  matched_parcel_id    uuid REFERENCES cadastre_parcels_cl(id) ON DELETE SET NULL,

  -- ── Resumen del grupo de anuncios ─────────────────────────────────────────
  listing_count        integer NOT NULL DEFAULT 0,   -- nº de listings_cl agrupados
  corredora_count      integer NOT NULL DEFAULT 0,   -- nº de corredoras DISTINTAS (advertiser_id) — >1 ⇒ sin exclusividad / en canje (H9)
  portals              text[]  NOT NULL DEFAULT '{}', -- fuentes: {portalinmobiliario, web:<dominio>, ...}
  source_types         text[]  NOT NULL DEFAULT '{}', -- {portal, agency_web, ...}
  advertiser_kinds     text[]  NOT NULL DEFAULT '{}', -- {particular}, {professional}, o ambos

  -- Estado / ciclo de vida — mismo patrón de retención que listings_cl: nunca
  -- se borra; is_active = algún anuncio del grupo sigue activo.
  is_active            boolean NOT NULL DEFAULT true,
  first_seen_at        timestamptz NOT NULL DEFAULT now(),  -- alta del primer anuncio del grupo
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_cl_comuna     ON property_cl(comuna_id);
CREATE INDEX IF NOT EXISTS idx_property_cl_geom       ON property_cl USING gist(geom);
CREATE INDEX IF NOT EXISTS idx_property_cl_active     ON property_cl(is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_property_cl_operation  ON property_cl(operation);
CREATE INDEX IF NOT EXISTS idx_property_cl_confidence ON property_cl(location_confidence);
CREATE INDEX IF NOT EXISTS idx_property_cl_rol        ON property_cl(rol_matriz) WHERE rol_matriz IS NOT NULL;
-- Propiedades multi-corredora (sin exclusividad aparente): consulta comercial
-- frecuente, se indexa el caso corredora_count > 1.
CREATE INDEX IF NOT EXISTS idx_property_cl_multi_corredora
  ON property_cl(corredora_count) WHERE corredora_count > 1;

-- ─── Vínculo listings_cl → property_cl ──────────────────────────────────────
-- El anuncio crudo pasa a "pertenecer" a un inmueble canónico. NULL hasta que
-- el dedup lo agrupa (mismo patrón que listings.property_id en España, 0004).
-- match_confidence: 0..1, confianza de pertenencia al grupo (1 para Nivel 1
-- determinista, el score del cluster para Nivel 2).
ALTER TABLE listings_cl
  ADD COLUMN IF NOT EXISTS property_cl_id   uuid REFERENCES property_cl(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_confidence numeric;

CREATE INDEX IF NOT EXISTS idx_listings_cl_property_cl
  ON listings_cl(property_cl_id);
-- Cola del clustering: anuncios activos aún sin agrupar a un property_cl.
CREATE INDEX IF NOT EXISTS idx_listings_cl_unclustered
  ON listings_cl(last_seen_at DESC) WHERE is_active AND property_cl_id IS NULL;
