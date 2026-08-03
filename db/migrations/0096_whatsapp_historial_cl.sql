-- ─────────────────────────────────────────────────────────────────────────────
-- 0096 · Historial de la verificación de WhatsApp
-- ─────────────────────────────────────────────────────────────────────────────
-- La 0095 guarda el ESTADO ACTUAL de cada número: si hoy está en WhatsApp y
-- cuál es su foto de hoy. Cada pasada del worker pisa la anterior, así que la
-- pregunta "¿este número tenía WhatsApp cuando lo captamos?" no se podía
-- responder — y es justo la que importa cuando una captación de hace meses no
-- contesta: saber si el número murió o si nunca estuvo.
--
-- Acá queda el rastro. NO una fila por pasada (serían millones sin aportar
-- nada: verificar 30 veces seguidas lo mismo no es información), sino una fila
-- por CAMBIO:
--   · la primera verificación de un número (su punto de partida),
--   · cuando `tiene_whatsapp` cambia (se dio de baja, o apareció),
--   · cuando la foto cambia (sha256 distinto).
--
-- La foto se guarda en cada fila del historial a propósito: es la única forma
-- de conservar la que tenía antes. Son ~10-60 KB y unos pocos cambios por
-- contacto al año.

CREATE TABLE IF NOT EXISTS whatsapp_verificaciones_hist_cl (
  id                bigserial PRIMARY KEY,
  phone_e164        text NOT NULL,

  tiene_whatsapp    boolean,
  jid               text,
  tiene_foto        boolean,
  foto_mime         text,
  foto_bytes        bytea,             -- la foto que tenía EN ESE MOMENTO
  foto_sha256       text,

  -- Qué disparó la fila: 'alta' (primera verificación), 'whatsapp' (cambió el
  -- registro), 'foto' (cambió la imagen). Pueden venir las dos últimas juntas.
  cambios           text[] NOT NULL DEFAULT '{}',

  verificado_at     timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- La consulta natural es "la historia de ESTE número, de lo más nuevo a lo más
-- viejo".
CREATE INDEX IF NOT EXISTS idx_wa_hist_cl_phone
  ON whatsapp_verificaciones_hist_cl (phone_e164, verificado_at DESC);

-- Y la de auditoría: "qué números perdieron WhatsApp este mes" (los que se
-- cayeron de las campañas sin que nadie se enterara).
CREATE INDEX IF NOT EXISTS idx_wa_hist_cl_bajas
  ON whatsapp_verificaciones_hist_cl (verificado_at DESC)
  WHERE tiene_whatsapp = false;
