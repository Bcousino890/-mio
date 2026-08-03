-- ─────────────────────────────────────────────────────────────────────────────
-- 0097 · Modo de trabajo del verificador de WhatsApp
-- ─────────────────────────────────────────────────────────────────────────────
-- Tal como quedó en la 0095, el worker barre TODOS los teléfonos de DealerNet
-- por antigüedad. Eso gasta el presupuesto real y limitado del verificador —
-- 800 checks al día, y sobre todo el riesgo de que Meta banee el número— en
-- números que a nadie le interesan hoy.
--
-- El modo lo decide quien usa el CRM, no el arranque del contenedor:
--
--   'solicitados' (por defecto) → SOLO lo pedido a mano: el botón "Verificar
--        WhatsApp (N)" de las fichas y el ↻ de cada teléfono. La cola de
--        pendientes queda quieta hasta que alguien la pida.
--   'barrido'                   → además, va completando el resto por
--        antigüedad cuando no hay nada pedido.
--
-- Vive en la tabla (no en una variable de entorno) para poder cambiarlo desde
-- Configuración sin redeploy: el worker lo relee en cada pasada.

ALTER TABLE whatsapp_verificador_cl
  ADD COLUMN IF NOT EXISTS modo text NOT NULL DEFAULT 'solicitados';

-- Se añade aparte del ADD COLUMN para que la migración sea reejecutable sin
-- reventar si la restricción ya existe.
ALTER TABLE whatsapp_verificador_cl
  DROP CONSTRAINT IF EXISTS whatsapp_verificador_cl_modo_check;
ALTER TABLE whatsapp_verificador_cl
  ADD CONSTRAINT whatsapp_verificador_cl_modo_check
  CHECK (modo IN ('solicitados', 'barrido'));
