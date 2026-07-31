-- ─────────────────────────────────────────────────────────────────────────────
-- 0092 · Selección manual de contactos para el envío a SmartBC
-- ─────────────────────────────────────────────────────────────────────────────
-- DealerNet devuelve mucho: 12 teléfonos y 23 relacionados en una ficha real de
-- Lo Barnechea. Volcarlos todos al CRM comercial no ayuda a quien va a llamar —
-- le entrega una lista de la que no sabe cuál es el dueño y cuál la cuñada del
-- cónyuge. Quien mira la ficha en /chile/captacion sí lo sabe, porque tiene
-- delante el parentesco, la categoría y de qué producto salió cada número.
--
-- Esta migración guarda esa decisión. Y guardarla es el punto: si la selección
-- solo filtrara en el momento del clic, la siguiente sincronización automática
-- —la que dispara un cambio de precio— volvería a mandar los 12 teléfonos y
-- borraría la curación. Persistida, el sincronizador la respeta siempre.
--
-- Cuando `smartbc_contactos` es NULL nadie ha elegido todavía: la sincronización
-- automática se comporta como hasta ahora (titular + relacionados con teléfono).
-- Con una lista guardada, viaja EXACTAMENTE eso y nada más. Los teléfonos que
-- DealerNet descubra después quedan esperando a que alguien los apruebe: no se
-- cuelan solos en la ficha del CRM.

ALTER TABLE captaciones_cl
  -- [{ phone, name, contact_type, relationship, rut, has_whatsapp, is_owner }]
  -- El nombre viaja junto al teléfono a propósito: el equipo corrige ahí la
  -- grafía del titular (TGR devuelve el nombre legal, no siempre el que usa la
  -- persona) y decide a qué relacionado pertenece cada número cuando DealerNet
  -- solo da el parentesco.
  ADD COLUMN IF NOT EXISTS smartbc_contactos jsonb,

  -- Quién y cuándo eligió. Sirve para responder "¿esta ficha la revisó alguien
  -- o subió en automático?" sin tener que cruzar con el log de sincronización.
  ADD COLUMN IF NOT EXISTS smartbc_contactos_at timestamptz,
  ADD COLUMN IF NOT EXISTS smartbc_contactos_by text;

-- Cola de revisión: captaciones con dueño y teléfonos que nadie ha curado aún.
CREATE INDEX IF NOT EXISTS idx_captaciones_cl_sin_seleccion
  ON captaciones_cl(updated_at DESC)
  WHERE smartbc_contactos IS NULL AND stage = 'contact_found';
