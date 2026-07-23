-- ─────────────────────────────────────────────────────────────────────────────
-- 0070 · listings_cl.features: características destacadas del inmueble
--        (plan Anuncios CL · ficha completa)
-- ─────────────────────────────────────────────────────────────────────────────
-- La ficha de la propiedad debe mostrar TODO como el CRM de referencia
-- (smartbc/captaciones): ubicación, características y descripción. La descripción
-- (`description`), la dirección (`address`) y las coordenadas (`latitude`/
-- `longitude`) ya se guardaban; faltaban las CARACTERÍSTICAS (amenities: jardín,
-- piscina, estacionamientos, bodega, antigüedad…), que el parser saca del blob
-- (`highlighted_specs_attrs_new`). Se guardan como un array JSON de etiquetas ya
-- formateadas ("Piscina", "Estacionamientos: 2"), listo para pintar como chips.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE listings_cl
  ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '[]'::jsonb;
