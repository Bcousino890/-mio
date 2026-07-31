-- ─────────────────────────────────────────────────────────────────────────────
-- 0088 · corredora_web_targets_cl: base_url explícita, plataforma 'konnect' y
--        alta de las corredoras verificadas contra HTML real
--        (plan Anuncios CL · Fase 4 / H21)
-- ─────────────────────────────────────────────────────────────────────────────
-- La 0069 dejó la tabla asumiendo que la URL de una web se podía derivar del
-- dominio como "https://www." || domain. Al verificar las webs reales una por
-- una eso resultó falso:
--
--   · ppartnersgroup.com  — www. redirige a /en-us/ (portada en inglés). La
--     base correcta es el dominio DESNUDO con locale es-cl.
--   · keyproperties.com   — responde igual con y sin www., pero su ficha NO
--     vive en "/<código>" como en el resto de Convecta: solo en
--     /fichaPropiedad.aspx?i=<código> ("/<código>" devuelve 500).
--
-- Derivar la URL del dominio funcionaba por casualidad en las tres semillas
-- originales. Se hace explícita en una columna: es un dato del target, no una
-- convención que el código pueda adivinar.
--
-- Además se admite la plataforma 'konnect' (Property Partners): no es un CRM
-- de terceros como Convecta/Ofinet sino la plataforma propia del grupo, con su
-- propia API JSON. Entra en el mismo registro porque el crawler la trata igual
-- —un adaptador por plataforma, N dominios— y así una franquicia con varios
-- dominios sobre Konnect reusa el adaptador sin código nuevo.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── base_url: origen absoluto del sitio, sin barra final ─────────────────────
-- Nullable: si viene NULL el crawler cae a "https://www." || domain, que es el
-- comportamiento histórico y sigue siendo correcto para la mayoría.
ALTER TABLE corredora_web_targets_cl
  ADD COLUMN IF NOT EXISTS base_url text;

ALTER TABLE corredora_web_targets_cl
  DROP CONSTRAINT IF EXISTS corredora_web_targets_cl_base_url_check;
ALTER TABLE corredora_web_targets_cl
  ADD CONSTRAINT corredora_web_targets_cl_base_url_check
  CHECK (base_url IS NULL OR base_url ~ '^https?://[^/]+$');

-- ── crm_platform: se suma 'konnect' ──────────────────────────────────────────
ALTER TABLE corredora_web_targets_cl
  DROP CONSTRAINT IF EXISTS corredora_web_targets_cl_crm_platform_check;
ALTER TABLE corredora_web_targets_cl
  ADD CONSTRAINT corredora_web_targets_cl_crm_platform_check
  CHECK (crm_platform IN ('convecta','ofinet','konnect','other','unknown'));

-- ── Cobertura declarada por el propio sitio ──────────────────────────────────
-- Las tres plataformas publican cuántas fichas dice tener el buscador
-- (numRegistros en Convecta, totalProperties en Konnect, el nº de páginas en
-- Ofinet). Guardarlo aparte de last_listing_count —que cuenta las fichas que el
-- crawl realmente descargó— convierte "faltan fichas" en algo medible: si
-- declarado > recogido, el barrido se quedó corto y hay que mirarlo, en vez de
-- descubrirlo semanas después por un hueco en el inventario.
ALTER TABLE corredora_web_targets_cl
  ADD COLUMN IF NOT EXISTS last_declared_count integer;

COMMENT ON COLUMN corredora_web_targets_cl.base_url IS
  'Origen absoluto del sitio sin barra final (ej. https://ppartnersgroup.com). NULL = derivar https://www.<domain>.';
COMMENT ON COLUMN corredora_web_targets_cl.last_declared_count IS
  'Fichas que el propio buscador del sitio dice tener en el último crawl. Comparado con last_listing_count mide si el barrido se quedó corto.';

-- ── Semillas verificadas contra HTML real (curl directo, julio 2026) ─────────
-- TODAS enabled=false: registrar ≠ activar, igual que en 0069. Se encienden a
-- mano tras validar el adaptador contra el sitio.
INSERT INTO corredora_web_targets_cl (domain, crm_platform, base_url, priority, notes)
VALUES
  ('elbarrio.cl',       'convecta', 'https://www.elbarrio.cl',    50,
   'Convecta dialecto corto (ac=). Ficha /<cod> y /fichaPropiedad.aspx?i=<cod>. 668 fichas declaradas (631 venta / 71 arriendo).'),
  ('keyproperties.com', 'convecta', 'https://keyproperties.com',  50,
   'Convecta dialecto corto (ac=). Ficha SOLO en /fichaPropiedad.aspx?i=<cod> ("/<cod>" da 500). 597 fichas declaradas (511 venta / 104 arriendo).'),
  ('ppartnersgroup.com','konnect',  'https://ppartnersgroup.com', 40,
   'Plataforma propia (Konnect). API JSON /api/properties/listing/. 10.870 fichas en Chile (9.753 venta / 1.117 arriendo).')
ON CONFLICT (lower(domain)) DO NOTHING;

-- Las tres semillas de 0069: se les fija base_url y se anota la cobertura
-- declarada verificada. magnoliaproperty.cl y cympropiedades.cl responden bien
-- con www.; se deja explícito igualmente para no depender de la convención.
UPDATE corredora_web_targets_cl
   SET base_url = 'https://www.magnoliaproperty.cl',
       notes = 'Convecta dialecto largo (acci=). Ficha /<cod> y /fichaPropiedad.aspx?i=<cod>. 1.116 fichas declaradas (920 venta).',
       updated_at = now()
 WHERE lower(domain) = 'magnoliaproperty.cl';

UPDATE corredora_web_targets_cl
   SET base_url = 'https://www.cympropiedades.cl',
       notes = 'Ofinet. Listado i_listing.asp (requiere cookie de sesión ASP para paginar). Ficha property.asp?idPro=<cod>. 759 fichas en venta.',
       updated_at = now()
 WHERE lower(domain) = 'cympropiedades.cl';

-- bpropiedades.cl sirve su listado por la OTRA vista de Ofinet
-- (i_listing-4-column.asp). i_listing.asp, que es la que funciona en
-- cympropiedades.cl, ahí devuelve cero fichas — y al revés. Cada instalación
-- tiene una vista activa y la otra muerta, sin forma de saber cuál sin probar
-- las dos: el adaptador prueba ambas en la primera página.
UPDATE corredora_web_targets_cl
   SET base_url = COALESCE(base_url, 'https://www.bpropiedades.cl'),
       notes = 'Ofinet. Listado por i_listing-4-column.asp (i_listing.asp devuelve 0 aquí). Ficha property.asp?idPro=<cod>, con precio y operación en texto corrido sin etiquetas. 920 fichas en venta.',
       updated_at = now()
 WHERE lower(domain) = 'bpropiedades.cl';
