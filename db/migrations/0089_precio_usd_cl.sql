-- Anuncios publicados en dólares: guardar el importe y convertirlo a pesos.
--
-- Unos pocos avisos de Portal Inmobiliario se publican en USD. Hasta la
-- migración anterior ni siquiera entraban: el CHECK de `currency` (0028) solo
-- admitía CLP y UF, así que el INSERT lanzaba y la ficha se perdía entera. Se
-- tapó normalizando la moneda a CLP y dejando el precio en NULL — sin inventar
-- un importe, pero también sin precio.
--
-- Ahora se cablea la tasa del dólar observado (mindicador.cl, misma fuente que
-- la UF) y el anuncio puede guardarse completo. Se calca el modelo que ya usa
-- la UF, que es el que el resto del sistema entiende:
--
--     currency = 'UF'   → price_uf  = importe publicado · price = price_uf  × uf_rate
--     currency = 'USD'  → price_usd = importe publicado · price = price_usd × usd_rate
--
-- `price` sigue siendo siempre CLP y siempre derivado, así que los filtros, el
-- precio/m² y el precio de mercado del cluster funcionan sin cambios. Y se
-- guarda la tasa usada con su fecha, igual que uf_rate/uf_rate_date: sin eso no
-- se podría auditar después por qué un anuncio valía lo que valía.

ALTER TABLE listings_cl ADD COLUMN IF NOT EXISTS price_usd     numeric;
ALTER TABLE listings_cl ADD COLUMN IF NOT EXISTS usd_rate      numeric;
ALTER TABLE listings_cl ADD COLUMN IF NOT EXISTS usd_rate_date date;

COMMENT ON COLUMN listings_cl.price_usd IS
  'Importe tal cual lo publicó el anuncio cuando la moneda es USD. price (CLP) se deriva de este × usd_rate.';

-- Ampliar el CHECK de moneda para admitir USD.
ALTER TABLE listings_cl DROP CONSTRAINT IF EXISTS listings_cl_currency_check;
ALTER TABLE listings_cl ADD CONSTRAINT listings_cl_currency_check
  CHECK (currency IN ('CLP', 'UF', 'USD'));

-- Los anuncios en dólares guardados mientras no había tasa quedaron marcados
-- como CLP y sin precio (el mal menor entonces). Se re-encolan para que el
-- scrapeo vuelva a leerlos y esta vez sí registren moneda e importe.
-- Idempotente: no encola lo que ya está pendiente o ejecutándose.
INSERT INTO pgboss.job (name, data, priority)
SELECT 'detail-cl',
       jsonb_build_object('externalId', l.external_id, 'sourceUrl', l.source_url),
       100
FROM listings_cl l
WHERE l.portal = 'portalinmobiliario'
  AND l.is_active
  AND l.source_url IS NOT NULL
  AND l.price IS NULL
  AND l.price_uf IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM pgboss.job j
    WHERE j.name = 'detail-cl' AND j.state IN ('created', 'active')
      AND j.data->>'externalId' = l.external_id
  );
