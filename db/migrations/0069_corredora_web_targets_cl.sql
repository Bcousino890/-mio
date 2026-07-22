-- ─────────────────────────────────────────────────────────────────────────────
-- 0069 · corredora_web_targets_cl: registro de webs propias de corredoras
--        (plan Anuncios CL · Fase 4 / H21)
-- ─────────────────────────────────────────────────────────────────────────────
-- Corrección del usuario (ver docs/PLAN-ANUNCIOS-CL.md · H21): NO hay forma de
-- descubrir automáticamente todas las webs de corredoras. Cada dominio es un
-- target que se registra a mano (o vía el enriquecimiento de corredoras_cl,
-- H4). Lo que SÍ se comparte es el ADAPTADOR: la mayoría corren su web sobre un
-- puñado de CRM inmobiliarios (Convecta, Ofinet, …). Cuando el detector
-- reconoce la plataforma, se reusa el adaptador ya escrito para ese CRM — solo
-- cambia el dominio — en vez de escribir un parser nuevo por corredora.
--
-- Esta tabla es a las webs propias lo que scrape_targets_cl (0063) es a las
-- comunas de Portal Inmobiliario: config-driven, un flag `enabled` por fila,
-- cadencia por fila. Activar el crawl de una corredora = insertar/actualizar
-- una fila, sin tocar código.
--
-- Cadencia por defecto MÁS SUAVE que la de PI (H22): son sitios pequeños de
-- bajo tráfico; tumbar la web de una corredora chica sería un daño reputacional
-- evitable. `interval_hours` arranca en 24 (una pasada diaria), no 8.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS corredora_web_targets_cl (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Dominio de la web propia, normalizado sin protocolo ni "www." ni barra
  -- final (ej. "magnoliaproperty.cl"). Es la clave natural del target: una web
  -- por corredora, y el UNIQUE evita registrarla dos veces.
  domain                 text NOT NULL,

  -- Corredora dueña de esta web (corredoras_cl, 0065). Nullable: una web puede
  -- registrarse ANTES de haber cruzado su identidad con el seller_id de PI
  -- (corredora descubierta solo por su web). El cruce lo completa el
  -- enriquecimiento (H4) rellenando este FK después.
  corredora_id           uuid REFERENCES corredoras_cl(id) ON DELETE SET NULL,

  -- Plataforma CRM detectada (detect-corredora-crm-cl.mjs, H21). Determina qué
  -- adaptador de crm-adapters/ se usa. 'unknown' hasta que el detector corra;
  -- 'other' = plataforma reconocida-como-no-soportada (queda registrada pero
  -- sin adaptador automático, pendiente de uno dedicado si el volumen lo amerita).
  crm_platform           text NOT NULL DEFAULT 'unknown'
                           CHECK (crm_platform IN ('convecta','ofinet','other','unknown')),

  -- Interruptor de crawl. Arranca en false: registrar una web NO la activa; se
  -- enciende a mano cuando se valida que el adaptador la parsea bien.
  enabled                boolean NOT NULL DEFAULT false,

  -- Cadencia de crawl (H22): 24h por defecto, mucho más suave que los 8h de PI.
  interval_hours         integer NOT NULL DEFAULT 24 CHECK (interval_hours > 0),

  -- Prioridad de encolado (menor = antes). Las corredoras de mayor volumen en
  -- PI se priorizan primero (H21: "priorizando las corredoras de mayor volumen").
  priority               integer NOT NULL DEFAULT 100,

  -- ── Observabilidad / cobertura (H17) ──────────────────────────────────────
  last_crawled_at        timestamptz,
  last_success_at        timestamptz,
  -- Nº de fichas que el último crawl encontró en la web. Comparado contra las
  -- de PI de la misma corredora, la diferencia = "inventario oculto" (H21):
  -- propiedades solo en su web = leads de captación.
  last_listing_count     integer,
  last_error             text,

  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Un target por dominio (normalizado). Índice único, no constraint de columna,
-- para poder normalizar el dominio en la app antes de insertar.
CREATE UNIQUE INDEX IF NOT EXISTS uq_corredora_web_targets_cl_domain
  ON corredora_web_targets_cl(lower(domain));

-- El scheduler del worker (H2) barre los targets `enabled` cuyo last_crawled_at
-- venció su interval_hours, ordenados por priority — mismo patrón que
-- scrape_targets_cl.
CREATE INDEX IF NOT EXISTS idx_corredora_web_targets_cl_due
  ON corredora_web_targets_cl(enabled, priority, last_crawled_at)
  WHERE enabled;

CREATE INDEX IF NOT EXISTS idx_corredora_web_targets_cl_corredora
  ON corredora_web_targets_cl(corredora_id) WHERE corredora_id IS NOT NULL;

-- Semilla con las corredoras-web verificadas en el plan (H21), TODAS enabled=false:
-- registrarlas ≠ activarlas. Se encienden a mano tras validar el adaptador.
--   Convecta: magnoliaproperty.cl
--   Ofinet:   cympropiedades.cl, bpropiedades.cl
INSERT INTO corredora_web_targets_cl (domain, crm_platform, notes)
VALUES
  ('magnoliaproperty.cl', 'convecta', 'Semilla verificada (meta author Convecta) · plan H21'),
  ('cympropiedades.cl',   'ofinet',   'Semilla verificada (footer Designed by Ofinet) · plan H21'),
  ('bpropiedades.cl',     'ofinet',   'Semilla verificada (footer Designed by Ofinet) · plan H21')
ON CONFLICT (lower(domain)) DO NOTHING;
