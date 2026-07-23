-- ─────────────────────────────────────────────────────────────────────────────
-- 0077 · property_cl: pin manual (corregido por el equipo, no extraído del anuncio)
-- ─────────────────────────────────────────────────────────────────────────────
-- latitude/longitude siguen siendo el pin declarado por el anuncio (el que
-- consolidateFields copia del listing con mayor location_confidence — ver
-- 0064). Estas dos columnas nuevas son un pin SEPARADO y opcional: la
-- corrección manual que el equipo agrega cuando el pin del portal está mal
-- puesto ("yo lo pongo", pedido explícito del usuario). Se muestran como un
-- SEGUNDO marcador en la ficha, no reemplazan al primero — permite comparar.
--
-- Guardar un pin manual marca location_confidence='confirmed' (reusa el enum
-- existente en vez de sumar un estado paralelo): un humano confirmando la
-- ubicación a mano es, por definición, el caso de máxima confianza.

ALTER TABLE property_cl
  ADD COLUMN IF NOT EXISTS manual_latitude  numeric,
  ADD COLUMN IF NOT EXISTS manual_longitude numeric,
  ADD COLUMN IF NOT EXISTS manual_pin_set_at timestamptz;
