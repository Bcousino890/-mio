-- ─────────────────────────────────────────────────────────────────────────────
-- 0091 · smartbc_sync_cl — trazabilidad del envío de captaciones al CRM SmartBC
-- ─────────────────────────────────────────────────────────────────────────────
-- Hasta ahora el paso de una captación al CRM comercial del equipo era MANUAL y
-- solo dejaba la marca `property_cl.smart_crm_at` ("ya la agregué a Smart", 0082):
-- un booleano con fecha que no dice qué se subió, ni cuándo cambió el precio
-- después, ni si el alta llegó a fallar. Con la API pública de SmartBC (v1) el
-- alta se automatiza, y esta tabla es el registro de esa conversación.
--
-- Una fila por captación sincronizada (no un histórico de llamadas): guarda el
-- ÚLTIMO estado conocido frente a SmartBC. Es lo que hace falta para las tres
-- preguntas operativas reales:
--
--   1. "¿esta captación ya está en el CRM y en qué ficha?"  → smartbc_id/admin_url
--   2. "¿hace falta reenviarla?"                            → payload_hash
--   3. "¿por qué no subió?"                                 → last_error* + request_id
--
-- `payload_hash` es la clave de la eficiencia: es el sha256 del último payload
-- ACEPTADO por SmartBC. Si el payload recalculado hoy da el mismo hash, la
-- captación no ha cambiado y no se manda NADA (ni siquiera para que la API
-- responda "unchanged"). `last_payload` guarda ese payload entero para poder
-- calcular el diff y mandar por PATCH solo los campos que se movieron, en vez de
-- reenviar la ficha completa —— y con ella la descarga de todas las fotos—— cada
-- vez que sube el precio.
--
-- `request_id` es el identificador que el equipo de SmartBC necesita para
-- encontrar nuestra petición exacta en su panel cuando algo no cuadre: se guarda
-- siempre, tanto en el éxito como en el error.

CREATE TABLE IF NOT EXISTS smartbc_sync_cl (
  captacion_id      uuid PRIMARY KEY REFERENCES captaciones_cl(id) ON DELETE CASCADE,

  -- El `external_id` que se envió, que es la identidad de la captación EN
  -- SmartBC ("mio-<uuid de captaciones_cl>"). Se persiste aunque sea derivable
  -- del captacion_id: si algún día cambia el prefijo, este registro sigue
  -- diciendo con qué id se dio de alta cada ficha en el CRM remoto.
  external_id       text NOT NULL UNIQUE,

  smartbc_id        text,          -- id interno de la captación en SmartBC
  admin_url         text,          -- enlace directo a la ficha en su panel

  -- Qué hizo el ÚLTIMO envío. 'skipped' = no se envió por decisión nuestra
  -- (p.ej. no es la captación principal de su property_cl, ver §2 del doc).
  last_action       text CHECK (last_action IN ('created','updated','unchanged','failed','skipped')),

  payload_hash      text,          -- sha256 del último payload aceptado
  last_payload      jsonb,         -- ese mismo payload, para calcular diffs

  -- Eco de la respuesta: qué cambió de verdad, qué NO se escribió por ser campo
  -- del equipo (propietario, dirección real, comuna, notas, etapa...) y qué
  -- avisos devolvió la validación. `protected_fields` es la prueba de que la
  -- sincronización no está pisando el trabajo manual del equipo comercial.
  changed_fields    text[],
  protected_fields  text[],
  warnings          jsonb,

  request_id        text,          -- id de la petición en el panel de SmartBC

  -- Último error, si lo hubo. No se limpia al arreglarse: `synced_at` posterior
  -- a `last_error_at` ya indica que se resolvió, y conservarlo permite ver el
  -- historial de fricción de una captación concreta.
  last_error_code   text,          -- 'validation_error', 'rate_limited', ...
  last_error_http   integer,
  last_error        text,
  last_error_at     timestamptz,

  attempts          integer NOT NULL DEFAULT 0,   -- envíos totales (incluidos los fallidos)
  synced_at         timestamptz,                  -- último envío ACEPTADO

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Cola de reparación: "¿qué se quedó sin subir?". Índice parcial porque lo
-- normal es que casi todo esté en 'created'/'updated'/'unchanged'.
CREATE INDEX IF NOT EXISTS idx_smartbc_sync_cl_failed
  ON smartbc_sync_cl(last_error_at DESC) WHERE last_action = 'failed';

-- Observabilidad de la corrida: qué se sincronizó y cuándo.
CREATE INDEX IF NOT EXISTS idx_smartbc_sync_cl_synced
  ON smartbc_sync_cl(synced_at DESC) WHERE synced_at IS NOT NULL;
