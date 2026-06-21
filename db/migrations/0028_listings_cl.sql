-- ─────────────────────────────────────────────────────────────────────────────
-- 0028 · Anuncios de mercado para Chile (listings_cl) + matches de dedup
-- ─────────────────────────────────────────────────────────────────────────────
-- Por qué una tabla NUEVA (`listings_cl`) en vez de añadir columnas a
-- `listings` (0004): seguimos el mismo patrón ya usado para todo lo demás de
-- Chile en este repo (`chile_comunas`/`cadastre_parcels_cl`/`property_rc_cl`
-- en 0020, `sii_roles_cl`/`sii_construcciones_cl` en 0021 — todas con sufijo
-- `_cl` en paralelo a su equivalente español, nunca bolteando conceptos
-- chilenos sobre las tablas españolas). Motivos concretos para Chile:
--
--   1) `listings` está pensada alrededor de barrio/distrito (zone_id →
--      `zones`, una taxonomía exclusivamente española/Madrid). Chile usa
--      comuna (`chile_comunas`, 0020) — una jerarquía administrativa
--      distinta, no un simple alias de "distrito".
--   2) Moneda dual UF/CLP: España no tiene equivalente a la UF (Unidad de
--      Fomento, indexada a inflación) — forzar `uf_price`/`uf_rate` como
--      columnas NULL-able en `listings` ensuciaría el 90% de las filas
--      (España) con conceptos que nunca aplican.
--   3) `location_confidence` (con sus 4 niveles) no existe en España porque
--      la dirección declarada por un particular ya es confiable allí (ver
--      cabecera de 0004). En Chile el pin/dirección del anuncio NO es
--      confiable por sí solo (ver docs/research-portalinmobiliario-chile.md)
--      y requiere un motor de triangulación dedicado
--      (`identity-resolution-cl.mjs`) — modelar esto como un CHECK adicional
--      sobre `rc_status` de España sería forzar una semántica binaria
--      ('none'/'rc14'/'rc20') a encajar un concepto de 4 niveles que no le
--      corresponde.
--   4) El blocking de dedup chileno (`group-candidates-cl.mjs`) es
--      DELIBERADAMENTE más laxo que el de España (ver cabecera de ese
--      archivo: 10+ corredoras republicando la misma propiedad con fotos y
--      m² inconsistentes) — reutilizar `find_match_candidates()`/
--      `listing_match` de 0008 mezclaría dos políticas de blocking
--      incompatibles sobre la misma tabla.
--
-- Mismo enum de `location_confidence` que `property_rc_cl.location_confidence`
-- (0020) para que ambos conceptos hablen el mismo vocabulario de confianza.
--
-- NO HAY capa `property_cl` deduplicada todavía (equivalente a `property` de
-- 0004) — fuera de alcance de esta migración. `listings_cl` es, por ahora,
-- solo la capa cruda (un anuncio por portal), igual que arrancó `listings`
-- antes de que existiera `property`/0008. El agrupamiento físico para Chile
-- vive hoy en candidatos de pares (`listing_match_cl`, más abajo) — la
-- consolidación a un "inmueble único chileno" es trabajo futuro, análogo a
-- cuando España pasó de matches sueltos a clustering real (ver 0008 vs
-- clustering.mjs).

-- PostGIS, pg_trgm y btree_gist ya están habilitados globalmente
-- (0001_extensions.sql / 0014_dedup_scoring.sql) — no se repiten aquí.

-- ─── listings_cl (anuncios crudos de portales chilenos) ─────────────────────
CREATE TABLE IF NOT EXISTS listings_cl (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- "fuente": hoy solo 'portalinmobiliario', pero se deja como texto libre
  -- igual que `listings.portal` en España para no tener que migrar el
  -- esquema el día que se sume otro portal chileno (ej. yapo.cl).
  portal               text NOT NULL DEFAULT 'portalinmobiliario',
  source_type          text NOT NULL DEFAULT 'portal'
                         CHECK (source_type IN ('portal','agency_web','own_web','external_web')),
  external_id          text NOT NULL,            -- ej. "MLC-123456789"
  source_url           text NOT NULL,

  operation            text CHECK (operation IN ('sale','rent')),
  advertiser_type      text NOT NULL DEFAULT 'unknown'
                         CHECK (advertiser_type IN ('particular','professional','unknown')),
  advertiser_name      text,                     -- corredora o nombre del particular
  phone                text,

  -- ── Moneda dual UF/CLP ──────────────────────────────────────────────────
  -- Portalinmobiliario publica indistintamente en UF o CLP. Se guardan AMBOS
  -- valores crudos más la tasa de conversión usada y su fecha, porque la UF
  -- cambia día a día y comparar precios de anuncios scrapeados en fechas
  -- distintas con una tasa fija sesgaría cualquier análisis histórico (ver
  -- TODO que cierra esta migración en scraper/lib/to-listing.mjs).
  price                integer,                  -- precio normalizado en CLP (el que usa el resto de la app)
  price_uf             numeric,                  -- valor UF tal cual lo publicó el anuncio (NULL si el anuncio era en CLP directo)
  uf_rate              numeric,                  -- CLP por 1 UF en el momento de la conversión (NULL si no se necesitó, ej. precio ya en CLP)
  uf_rate_date         date,                     -- fecha de la serie UF usada (mindicador.cl/BCCh) — NO necesariamente "hoy" si se reprocesa un anuncio viejo
  currency             text NOT NULL DEFAULT 'CLP' CHECK (currency IN ('CLP','UF')), -- moneda tal cual la publicó el anuncio originalmente

  bedrooms             integer,
  bathrooms            integer,
  square_meters        integer,
  property_type        text,

  -- ── Comuna en vez de barrio/distrito ────────────────────────────────────
  comuna_id            uuid REFERENCES chile_comunas(id) ON DELETE SET NULL,
  comuna_raw           text,                     -- comuna tal cual vino del scraper, antes de normalizeComuna()
  localidad            text,                     -- sector/balneario con identidad propia dentro de la comuna (ej. "Cachagua" en Zapallar)
  address              text,
  exact_address        text,                     -- solo cuando se resuelve identidad con confianza alta

  -- Pin "declarado por el vendedor" — ver nota en location_confidence: NO se
  -- asume confiable solo por existir, a diferencia de latitude/longitude en
  -- `listings` (España).
  latitude             numeric,
  longitude            numeric,
  geom                 geometry(Point, 4326) GENERATED ALWAYS AS (
                         CASE WHEN longitude IS NOT NULL AND latitude IS NOT NULL
                              THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
                              ELSE NULL END
                       ) STORED,

  description          text,
  features             jsonb,
  photos                jsonb,
  cover_phash           text,
  photo_phashes         text[] NOT NULL DEFAULT '{}',

  -- ── Resolución de identidad (identity-resolution-cl.mjs) ────────────────
  -- Mismo enum que property_rc_cl.location_confidence (0020) para mantener
  -- un único vocabulario de confianza de ubicación en todo el módulo Chile.
  -- A diferencia de España (rc_status, binario 'none'/'rc14'/'rc20' porque
  -- la dirección de un particular ya es confiable), aquí el pin requiere
  -- triangulación: 'none' (sin intentar) → 'candidate' (alguna señal débil)
  -- → 'pin_suspect' (señal explícita de pin puesto a mano/sospechoso,
  -- prioritaria sobre el score numérico — ver identity-resolution-cl.mjs) →
  -- 'confirmed' (score alto + parcela limpia encontrada).
  location_confidence   text NOT NULL DEFAULT 'none'
                          CHECK (location_confidence IN ('none', 'candidate', 'pin_suspect', 'confirmed')),
  -- Rol de avalúo candidato (equivalente RC14-CL) que propuso el motor de
  -- identidad. Se llama explícitamente "candidate" (no "rol_matriz" a secas
  -- como en property_rc_cl) porque aquí vive en la fila del ANUNCIO, una
  -- hipótesis por anuncio individual, mientras que property_rc_cl es la
  -- tabla de resolución consolidada — distinción deliberada de nombre para
  -- no confundir "lo que sugirió el motor para este anuncio" con "lo que ya
  -- se confirmó a nivel de propiedad".
  rol_matriz_candidate   text,
  -- Parcela catastral (geometría IDE Chile, NUNCA sii.cl — ver 0020) que el
  -- motor de identidad usó como ancla para esa sugerencia, si la encontró.
  matched_parcel_id      uuid REFERENCES cadastre_parcels_cl(id) ON DELETE SET NULL,
  identity_score         numeric,                 -- score 0..1 combinado de resolvePropertyIdentity()
  identity_signals       jsonb,                    -- payload completo de `signals` (triangulación, geocode, parcela, footprint, aerial) para auditoría/debug
  identity_resolved_at   timestamptz,              -- NULL hasta la primera corrida del dedup-runner-cl

  -- Estado / ciclo de vida — mismo patrón de retención que `listings`
  -- (España): nunca se borra, se marca 'gone' cuando desaparece del portal.
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active','gone')),
  is_active            boolean NOT NULL DEFAULT true,
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  taken_down_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  UNIQUE (portal, external_id)
);

CREATE INDEX IF NOT EXISTS idx_listings_cl_geom        ON listings_cl USING gist(geom);
CREATE INDEX IF NOT EXISTS idx_listings_cl_comuna      ON listings_cl(comuna_id);
CREATE INDEX IF NOT EXISTS idx_listings_cl_advertiser  ON listings_cl(advertiser_type);
CREATE INDEX IF NOT EXISTS idx_listings_cl_operation   ON listings_cl(operation);
CREATE INDEX IF NOT EXISTS idx_listings_cl_active      ON listings_cl(is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_listings_cl_portal      ON listings_cl(portal);
CREATE INDEX IF NOT EXISTS idx_listings_cl_cover_phash ON listings_cl(cover_phash) WHERE cover_phash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_cl_confidence  ON listings_cl(location_confidence);
CREATE INDEX IF NOT EXISTS idx_listings_cl_parcel      ON listings_cl(matched_parcel_id);
-- Dedup por texto (fallback): trigram sobre descripción, igual que listings (España).
CREATE INDEX IF NOT EXISTS idx_listings_cl_desc_trgm   ON listings_cl USING gin(description gin_trgm_ops);
-- Cola de trabajo del dedup-runner-cl: anuncios activos aún no procesados por
-- identity-resolution-cl.mjs en esta corrida.
CREATE INDEX IF NOT EXISTS idx_listings_cl_unresolved
  ON listings_cl(last_seen_at DESC) WHERE is_active AND identity_resolved_at IS NULL;
-- Blocking laxo de group-candidates-cl.mjs: filtra primero por comuna+activo
-- (su `requireSameComuna` por defecto) antes de aplicar el resto de la
-- lógica en JS (precio/distancia/teléfono/agencia) — deliberadamente SIN
-- bedrooms/square_meters en este índice, a diferencia de
-- idx_listings_block de España (0004), porque ese blocking NO filtra por
-- esos campos (ver cabecera de group-candidates-cl.mjs).
CREATE INDEX IF NOT EXISTS idx_listings_cl_block
  ON listings_cl(comuna_id, operation) WHERE is_active;

-- ─── listing_match_cl (pares candidatos a misma propiedad física) ───────────
-- Análoga a `listing_match` (0008) pero para Chile, con dos diferencias:
--   1) El blocking que produce los pares a evaluar es JS puro
--      (group-candidates-cl.mjs), no una función SQL — porque ese blocking
--      es deliberadamente laxo y depende de señales "duras" (teléfono,
--      agencia) que conviene comparar en memoria sobre el pool ya cargado,
--      no repetir como función STABLE por cada listing.
--   2) `signals` aquí es el payload combinado de identity-resolution-cl.mjs
--      (triangulación + geocode + parcela + footprint + aerial), no las
--      señales puramente geométricas/fotográficas de `calculate_match_signals`
--      (0014) — aunque la sub-señal de huella física SÍ reutiliza
--      `matching.mjs` internamente (ver cabecera de identity-resolution-cl.mjs).
-- No hay tabla `property_cl` deduplicada aún (ver nota de cabecera) — por
-- ahora este es el techo de la deduplicación chilena: pares con score, no
-- clusters consolidados.
CREATE TABLE IF NOT EXISTS listing_match_cl (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_a   uuid NOT NULL REFERENCES listings_cl(id) ON DELETE CASCADE,
  listing_b   uuid NOT NULL REFERENCES listings_cl(id) ON DELETE CASCADE,
  score       numeric NOT NULL,                 -- 0..1, score combinado de resolvePropertyIdentity()/triangulación
  signals     jsonb,                            -- payload de signals + explanation
  status      text NOT NULL DEFAULT 'candidate'
                CHECK (status IN ('candidate','confirmed','rejected')),
  decided_by  text NOT NULL DEFAULT 'auto'
                CHECK (decided_by IN ('auto','human')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz,
  CHECK (listing_a <> listing_b),
  UNIQUE (listing_a, listing_b)                 -- el runner inserta el par ordenado (a<b), igual que 0008
);

CREATE INDEX IF NOT EXISTS idx_match_cl_a      ON listing_match_cl(listing_a);
CREATE INDEX IF NOT EXISTS idx_match_cl_b      ON listing_match_cl(listing_b);
CREATE INDEX IF NOT EXISTS idx_match_cl_status ON listing_match_cl(status);
CREATE INDEX IF NOT EXISTS idx_match_cl_score  ON listing_match_cl(score DESC);
