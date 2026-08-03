-- ─────────────────────────────────────────────────────────────────────────────
-- 0095 · Verificación en vivo de WhatsApp para los teléfonos de DealerNet
-- ─────────────────────────────────────────────────────────────────────────────
-- DealerNet ya entrega dos señales de WhatsApp por teléfono (0035):
--   · `ind_whatsapp` — bandera de SU base, sin fecha: no se sabe de cuándo es.
--   · `idimagen`     — foto de perfil servida por el portal (suite.dealernet.cl),
--                      también una copia de su base, no la foto actual.
-- En la práctica ambas envejecen: números dados de baja siguen marcados como
-- WhatsApp y la foto es la que DealerNet capturó cuando armó el registro.
--
-- Esta tabla guarda la verificación CONTRA WHATSAPP EN VIVO, hecha por el
-- worker `scraper/whatsapp-verify-worker.mjs` (Baileys, sesión de un número
-- propio). No reemplaza el dato de DealerNet: se muestra al lado, con su
-- fecha, para que quien llama sepa qué está mirando.
--
-- ⚠️ Operación y riesgos (baneo del número verificador, RGPD/ToS): ver
-- docs/WHATSAPP-VERIFICACION.md antes de encender el worker.
--
-- La clave es el teléfono normalizado (+56...), NO el contacto: el mismo
-- número aparece en varios RUT (sociedades, familiares) y se verifica una vez.

CREATE TABLE IF NOT EXISTS whatsapp_verificaciones_cl (
  phone_e164        text PRIMARY KEY,

  -- Resultado del check de registro (`onWhatsApp`). NULL = todavía sin
  -- verificar; false = el número NO está en WhatsApp hoy.
  tiene_whatsapp    boolean,
  jid               text,              -- p.ej. "56995429258@s.whatsapp.net"

  -- Foto de perfil. OJO: "sin foto" y "foto restringida a contactos" son
  -- indistinguibles desde fuera — ambas devuelven vacío. Por eso el campo se
  -- llama `tiene_foto` (visible para nosotros), no "el usuario tiene foto".
  tiene_foto        boolean,
  foto_mime         text,
  foto_bytes        bytea,             -- la imagen, no la URL: las URLs de
                                       -- WhatsApp caducan en horas.
  foto_sha256       text,              -- para detectar que CAMBIÓ la foto
  foto_cambiada_at  timestamptz,       -- última vez que el sha cambió

  estado            text NOT NULL DEFAULT 'pendiente'
                      CHECK (estado IN ('pendiente', 'ok', 'error')),
  error             text,
  intentos          int NOT NULL DEFAULT 0,
  verificado_at     timestamptz,       -- último intento CON resultado
  -- Marca del botón "Verificar ahora" de la ficha: la próxima pasada del
  -- worker atiende estos números antes que la cola normal por antigüedad.
  revalidar_pedido_at timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Orden de trabajo del worker: primero lo pedido a mano, después lo nunca
-- verificado, después lo más viejo. El índice cubre las tres ramas.
CREATE INDEX IF NOT EXISTS idx_wa_verif_cl_pendientes
  ON whatsapp_verificaciones_cl (revalidar_pedido_at DESC NULLS LAST, verificado_at ASC NULLS FIRST);

CREATE OR REPLACE FUNCTION whatsapp_verificaciones_cl_touch_updated_at()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_verificaciones_cl_touch ON whatsapp_verificaciones_cl;
CREATE TRIGGER trg_whatsapp_verificaciones_cl_touch
  BEFORE UPDATE ON whatsapp_verificaciones_cl
  FOR EACH ROW EXECUTE FUNCTION whatsapp_verificaciones_cl_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Estado del verificador (una sola fila). Sirve para dos cosas concretas:
--  1. La UI puede decir "sin verificador vinculado" en vez de mostrar todos
--     los números como "pendiente" para siempre.
--  2. El QR de vinculación queda accesible sin entrar al contenedor a leer
--     logs (el worker lo escribe acá y lo borra al conectar).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_verificador_cl (
  id                boolean PRIMARY KEY DEFAULT true CHECK (id),
  estado            text NOT NULL DEFAULT 'desvinculado'
                      CHECK (estado IN ('desvinculado', 'esperando_qr', 'conectando', 'conectado', 'baneado', 'error')),
  numero_e164       text,              -- el número verificador (burner)
  qr                text,              -- QR vigente mientras estado = esperando_qr
  ultimo_error      text,
  conectado_at      timestamptz,
  checks_dia        int NOT NULL DEFAULT 0,
  checks_dia_fecha  date,              -- día al que corresponde `checks_dia`
  updated_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO whatsapp_verificador_cl (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_whatsapp_verificador_cl_touch ON whatsapp_verificador_cl;
CREATE TRIGGER trg_whatsapp_verificador_cl_touch
  BEFORE UPDATE ON whatsapp_verificador_cl
  FOR EACH ROW EXECUTE FUNCTION whatsapp_verificaciones_cl_touch_updated_at();
