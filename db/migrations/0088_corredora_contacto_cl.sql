-- ─────────────────────────────────────────────────────────────────────────────
-- 0088 · Ficha de empresa de la corredora: contacto + personas
--        (plan Anuncios CL · H4/H21 — enriquecimiento desde la web propia)
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ COLUMNAS NUEVAS Y NO `corredoras_cl.phones`:
-- `phones` (0065) la reescribe entera el job de dedup (dedup-cl.mjs:
-- `UPDATE corredoras_cl SET phones = $2`) con los teléfonos vistos en los
-- ANUNCIOS. Si el enriquecimiento escribiera ahí, la siguiente corrida de dedup
-- borraría lo scrapeado de la web. Son dos procedencias distintas con dos
-- dueños distintos: se guardan separadas y la ficha las une al leer.
--
-- PROCEDENCIA DE CADA DATO (verificado con HTML real, ver
-- docs/CONTACTO-CORREDORAS-CL.md):
--   · Portal Inmobiliario / API de Mercado Libre → NO expone teléfono (contacto
--     por formulario; `api.mercadolibre.com` responde 403 sin access_token).
--   · Web propia de la corredora → SÍ: teléfono, WhatsApp, email, dirección,
--     redes y, cuando hay página de equipo, nombres y cargos.
-- Por eso todo lo de aquí se llena desde `web_propia_url`, y `contact_status`
-- deja explícito cuándo no se pudo (sin web registrada, error de red, web sin
-- datos) en vez de dejar NULLs mudos.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE corredoras_cl
  -- Teléfonos en E.164 (+56XXXXXXXXX). Separados de `phones` (procedencia
  -- anuncios) por el motivo de la cabecera.
  ADD COLUMN IF NOT EXISTS contact_phones     text[] NOT NULL DEFAULT '{}',
  -- Subconjunto de los anteriores que además está publicado como WhatsApp
  -- (enlace wa.me / api.whatsapp.com): es el canal que de verdad contesta.
  ADD COLUMN IF NOT EXISTS contact_whatsapp   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS contact_emails     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS contact_address    text,
  -- { facebook, instagram, linkedin, youtube, tiktok, twitter } → URL.
  ADD COLUMN IF NOT EXISTS contact_socials    jsonb  NOT NULL DEFAULT '{}'::jsonb,
  -- URLs concretas de las que salió cada dato: sin esto un teléfono equivocado
  -- no es auditable.
  ADD COLUMN IF NOT EXISTS contact_source_urls text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS contact_status     text NOT NULL DEFAULT 'pending'
                             CHECK (contact_status IN ('pending','ok','empty','no_web','error')),
  ADD COLUMN IF NOT EXISTS contact_error      text,
  ADD COLUMN IF NOT EXISTS contact_updated_at timestamptz;

-- Cola del enriquecimiento: corredoras con web propia registrada cuya ficha de
-- contacto nunca se llenó o está vieja. El runner ordena por stock activo.
CREATE INDEX IF NOT EXISTS idx_corredoras_cl_contacto_due
  ON corredoras_cl(contact_updated_at NULLS FIRST, active_listings_count DESC)
  WHERE web_propia_url IS NOT NULL;

-- ─── Personas de la corredora (equipo, jefaturas, dueños) ────────────────────
-- Una fila por persona vista. NO se borra al re-enriquecer: si alguien
-- desaparece de la web, queda con `last_seen_at` viejo — el histórico de quién
-- pasó por la corredora es justamente parte del valor de la ficha.
--
-- Estos son datos personales (Ley 19.628 / 21.719): se guarda solo lo que la
-- propia corredora publica en su web corporativa como canal de contacto
-- profesional, junto a la URL exacta de donde salió.
CREATE TABLE IF NOT EXISTS corredora_personas_cl (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corredora_id   uuid NOT NULL REFERENCES corredoras_cl(id) ON DELETE CASCADE,

  full_name      text NOT NULL,
  role_raw       text,                       -- cargo tal cual aparece ("Gerente Comercial")
  -- Clasificación del cargo para poder filtrar "con quién hay que hablar":
  --   jefatura  = gerente / director / socio / dueño / fundador / rep. legal
  --   ejecutivo = ejecutiva, asesor, agente, corredor, encargado
  --   desconocido = nombre detectado sin cargo legible
  role_kind      text NOT NULL DEFAULT 'desconocido'
                   CHECK (role_kind IN ('jefatura','ejecutivo','desconocido')),
  email          text,
  phone          text,                       -- E.164
  photo_url      text,

  -- De dónde salió: 'web_propia' (scrapeado) | 'manual' (alta a mano en el CRM).
  source         text NOT NULL DEFAULT 'web_propia'
                   CHECK (source IN ('web_propia','manual')),
  source_url     text,

  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Una persona por corredora, comparando el nombre normalizado (la web repite el
-- mismo nombre con distinta capitalización entre páginas).
CREATE UNIQUE INDEX IF NOT EXISTS uq_corredora_personas_cl_nombre
  ON corredora_personas_cl(corredora_id, lower(full_name));
CREATE INDEX IF NOT EXISTS idx_corredora_personas_cl_corredora
  ON corredora_personas_cl(corredora_id, role_kind);
