-- ─────────────────────────────────────────────────────────────────────────────
-- 0078 · Reconstruir la deduplicación con la regla corredora + código interno
-- ─────────────────────────────────────────────────────────────────────────────
-- REGLA NUEVA (decisión del usuario): dos anuncios son la misma propiedad SOLO
-- si coinciden la corredora (advertiser_id) Y su código interno
-- (seller_reference, ej. "BV3535"). Si no coinciden ambos, NO se deduplica:
-- cada anuncio queda como su propia ficha. Venta y arriendo de la misma
-- propiedad (mismo código interno) quedan agrupados en UNA ficha.
--
-- Los `property_cl` existentes se construyeron con la regla anterior
-- (`property_code` de Mercado Libre + clustering probabilístico), que fusionaba
-- fichas que no eran la misma propiedad. Hay que rehacerlos: `property_cl` es
-- dato DERIVADO, se reconstruye entero desde `listings_cl` en la próxima pasada
-- del job `dedup-cluster-cl` del worker.
--
-- Se preservan los PINES MANUALES (0077): son correcciones hechas a mano por el
-- equipo y no deben perderse al rehacer los grupos. Se guardan por
-- `external_id` del anuncio (identificador estable, sobrevive al re-agrupado) y
-- el dedup los vuelve a aplicar al recrear cada ficha.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS property_cl_manual_pin_backup (
  external_id       text PRIMARY KEY,
  manual_latitude   double precision,
  manual_longitude  double precision,
  saved_at          timestamptz NOT NULL DEFAULT now()
);

-- Un pin por anuncio. Si varios anuncios comparten la ficha corregida, todos
-- quedan respaldados: al reconstruir, cualquiera de ellos restaura el pin.
INSERT INTO property_cl_manual_pin_backup (external_id, manual_latitude, manual_longitude)
SELECT DISTINCT ON (l.external_id)
       l.external_id, p.manual_latitude, p.manual_longitude
FROM property_cl p
JOIN listings_cl l ON l.property_cl_id = p.id
WHERE p.manual_latitude IS NOT NULL AND p.manual_longitude IS NOT NULL
ORDER BY l.external_id, p.updated_at DESC
ON CONFLICT (external_id) DO NOTHING;

-- Reset: soltar los anuncios de sus grupos y borrar las fichas derivadas. El
-- worker las reconstruye con la regla nueva (no se pierde nada de listings_cl,
-- que es la fuente de verdad).
UPDATE listings_cl SET property_cl_id = NULL, updated_at = now()
  WHERE property_cl_id IS NOT NULL;

DELETE FROM property_cl;
