-- ─────────────────────────────────────────────────────────────────────────────
-- 0083 · Enlace explícito property_cl ↔ captaciones_cl
-- ─────────────────────────────────────────────────────────────────────────────
-- Hasta ahora la ficha de Propiedades y el CRM de Captación se cruzaban SOLO
-- por coincidencia de rol SII + comuna (ver CRM_JSON en /api/chile/property-cl).
-- Eso hacía el flujo invisible en los dos sentidos:
--
--   · en /chile/propiedades una ficha ya captada no se distinguía de una sin
--     captar (la tarjeta no tenía de dónde sacar el dato barato), y
--   · en /chile/captacion no había forma de volver al inmueble que la originó.
--
-- Con el enlace guardado, "guardar la ubicación" deja huella permanente en las
-- dos direcciones: la propiedad sabe cuál es su captación (y por tanto si ya
-- está captada, con dueño y teléfonos) y la captación sabe de qué ficha salió.
-- El cruce por rol se mantiene como respaldo para lo ya existente.

ALTER TABLE captaciones_cl
  ADD COLUMN IF NOT EXISTS property_cl_id uuid REFERENCES property_cl(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_captaciones_cl_property
  ON captaciones_cl(property_cl_id) WHERE property_cl_id IS NOT NULL;

ALTER TABLE property_cl
  ADD COLUMN IF NOT EXISTS captacion_id uuid REFERENCES captaciones_cl(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_property_cl_captacion
  ON property_cl(captacion_id) WHERE captacion_id IS NOT NULL;

-- Backfill: todo lo que ya estaba cruzándose por rol queda enlazado de verdad,
-- para que las etiquetas "captada" aparezcan sobre el histórico y no solo sobre
-- lo que se guarde de aquí en adelante. Se elige la captación más completa del
-- rol (mismo criterio que findCrmCaptacionByRol).
UPDATE property_cl p
   SET captacion_id = (
     SELECT cap.id
       FROM captaciones_cl cap
       JOIN chile_comunas c ON c.id = p.comuna_id
      WHERE cap.sii_rol = p.rol_matriz
        AND cap.sii_comuna_code = c.sii_comuna_code
      ORDER BY (cap.owner_name IS NOT NULL) DESC,
               (cap.phones IS NOT NULL) DESC,
               cap.updated_at DESC
      LIMIT 1
   )
 WHERE p.captacion_id IS NULL
   AND p.rol_matriz IS NOT NULL
   AND EXISTS (
     SELECT 1
       FROM captaciones_cl cap
       JOIN chile_comunas c ON c.id = p.comuna_id
      WHERE cap.sii_rol = p.rol_matriz
        AND cap.sii_comuna_code = c.sii_comuna_code
   );

-- Lo mismo para las captaciones que nacieron de una URL suelta: su anuncio ya
-- pertenece a una ficha por el dedup, así que el inmueble es el mismo sin
-- adivinar por rol. (Es el mismo enlace que ahora escribe el pipeline al fijar
-- el rol; aquí solo se aplica al histórico.)
UPDATE property_cl p
   SET captacion_id = cap.id
  FROM captaciones_cl cap
  JOIN listings_cl l ON l.id = cap.listing_cl_id
 WHERE p.captacion_id IS NULL
   AND p.id = l.property_cl_id;

UPDATE captaciones_cl cap
   SET property_cl_id = p.id
  FROM property_cl p
 WHERE cap.property_cl_id IS NULL
   AND p.captacion_id = cap.id;
