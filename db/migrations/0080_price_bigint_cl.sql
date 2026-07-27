-- ─────────────────────────────────────────────────────────────────────────────
-- 0080 · Precios en CLP a bigint: `integer` se desbordaba con las propiedades
--        caras y esos anuncios NUNCA llegaban a guardarse
-- ─────────────────────────────────────────────────────────────────────────────
-- El máximo de `integer` en Postgres es 2.147.483.647. Los precios de Chile se
-- normalizan a CLP (resolvePriceClp, to-listing.mjs: price_uf × tasa UF), así
-- que cualquier propiedad por encima de ~52.500 UF lo supera:
--
--     55.000 UF × 40.844,79 = 2.246.463.450  →  fuera de rango
--
-- Y no es un caso raro: solo en Las Condes el portal declara 68 casas entre
-- 55.000 y 110.000 UF, más otras 5 por encima. El INSERT lanzaba
-- «value "2246463450" is out of range for type integer», el job de la ficha
-- moría y el anuncio no entraba jamás — se veía en el barrido pero nunca
-- aparecía en el CRM. Además el umbral EMPEORA con el tiempo: la UF sube cada
-- día, así que el techo en UF va bajando.
--
-- bigint (hasta 9,2 trillones) da margen de sobra. Se migran también las dos
-- columnas del histórico de precios, que comparan contra las mismas cifras y
-- reventarían igual al registrar el cambio de precio de una propiedad cara.
--
-- ALTER de integer→bigint reescribe la tabla (ambos son de ancho fijo, no hay
-- riesgo de pérdida: bigint contiene a integer). Idempotente.

ALTER TABLE listings_cl              ALTER COLUMN price        TYPE bigint;
ALTER TABLE property_cl              ALTER COLUMN canonical_price TYPE bigint;
ALTER TABLE listing_version_log_cl   ALTER COLUMN price_before TYPE bigint;
ALTER TABLE listing_version_log_cl   ALTER COLUMN price_after  TYPE bigint;
