-- ─────────────────────────────────────────────────────────────────────────────
-- 0089 · portal_store_slug: la tienda oficial de la corredora EN el propio
--        Portal Inmobiliario (plan Anuncios CL · H4/H23 — barrido sin techo)
-- ─────────────────────────────────────────────────────────────────────────────
-- Hallazgo que motiva esta migración: el barrido de anuncios es HOY por comuna
-- (scrape_targets_cl, 0063), y solo Las Condes está activada. Una corredora
-- grande (Property Partners, verificado en vivo) publica en TODA la RM: su
-- tienda oficial declara 1.966 casas en venta, pero `corredoras_cl` solo
-- conocía ~1.000 — el resto vive en comunas que el barrido general aún no
-- toca. Ampliar comuna por comuna escala mal; cada corredora YA declara su
-- propio inventario completo en su tienda oficial dentro del portal:
--
--   https://www.portalinmobiliario.com/tienda/<slug>/listado/inmuebles/
--     <tipo>/propiedades-usadas/rm-metropolitana
--
-- Verificado con HTML real (CyM Propiedades, 506 resultados; Remax Diamante):
-- misma paginación `_Desde_N` de 48 en 48 y el mismo blob
-- `__NORDIC_RENDERING_CTX__` que ya parsea `parseListPage`/`parseListMeta` —
-- cero código de parseo nuevo, solo un builder de URL distinto.
--
-- A diferencia de `web_propia_url` (que hay que registrar a mano o cruzar por
-- CRM detectado), el slug de la tienda oficial se puede sacar de CUALQUIER
-- ficha de anuncio de esa corredora ya scrapeada: el enlace "Ir a la tienda
-- oficial de <nombre>" es parte del HTML estándar del portal. Se descubre solo,
-- sin registro manual — mismo patrón que `advertiser_logo` (columna 0075):
-- se extrae en el detail parser, se guarda por anuncio en `listings_cl`, y
-- `runCorredoraConsolidationCl` (dedup-cl.mjs) elige el más reciente no nulo
-- para la corredora, igual que ya hace con el logo.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE listings_cl
  ADD COLUMN IF NOT EXISTS advertiser_store_slug text;

ALTER TABLE corredoras_cl
  ADD COLUMN IF NOT EXISTS portal_store_slug text,
  -- Última vez que se hizo un barrido COMPLETO (sin comuna, RM entera) de su
  -- tienda oficial. NULL = nunca barrida así; la cola del runner prioriza
  -- primero las que nunca se barrieron y luego las más viejas.
  ADD COLUMN IF NOT EXISTS store_swept_at timestamptz;

-- Un slug puede repetirse entre cuentas de vendedor de la MISMA corredora
-- (Property Partners con 9 cuentas podría compartir tienda, o no — no se
-- asume); por eso índice simple, no único.
CREATE INDEX IF NOT EXISTS idx_corredoras_cl_store_slug
  ON corredoras_cl(portal_store_slug) WHERE portal_store_slug IS NOT NULL;

-- Cola del barrido por tienda: corredoras con slug conocido, priorizadas por
-- stock (barrer primero a las grandes, que son las que más se benefician de
-- saltarse la limitación de comuna) y por antigüedad del último barrido.
CREATE INDEX IF NOT EXISTS idx_corredoras_cl_store_sweep_due
  ON corredoras_cl(store_swept_at NULLS FIRST, active_listings_count DESC)
  WHERE portal_store_slug IS NOT NULL;
