-- ─────────────────────────────────────────────────────────────────────────────
-- 0063 · scrape_targets_cl: objetivos de barrido config-driven (plan Anuncios CL · H8)
-- ─────────────────────────────────────────────────────────────────────────────
-- Decisión del usuario (ver docs/PLAN-ANUNCIOS-CL.md §3, decisión #2): dejar la
-- estructura lista para TODAS las comunas de la RM, pero arrancar el barrido 24/7
-- solo con Las Condes. En vez de hardcodear las comunas en `worker-cl.mjs`, el
-- discovery crawler (H1) LEE esta tabla al programar sus jobs: activar el resto
-- de la RM = un `UPDATE scrape_targets_cl SET enabled = true ...`, sin tocar
-- código ni redesplegar.
--
-- Cada fila es un objetivo (comuna × tipo de propiedad × operación). El worker
-- programa un job `discovery:<comuna>:<tipo>:<op>` por cada fila `enabled`, con
-- la cadencia de `interval_hours` (decisión #3 del usuario: cada 8h para las
-- comunas activas).
--
-- Casas usadas primero (H6): se siembra `property_type = 'casa'`. Departamentos
-- y terrenos se activan después sumando filas (mismo pipeline, cambia el filtro
-- de tipo en la URL de listado) — por eso `property_type` es texto libre y no un
-- enum cerrado, para no migrar el esquema al sumar tipos.

CREATE TABLE IF NOT EXISTS scrape_targets_cl (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Comuna objetivo. FK a la taxonomía administrativa chilena ya sembrada
  -- (chile_comunas, 0020) — misma clave que usa listings_cl.comuna_id.
  comuna_id              uuid NOT NULL REFERENCES chile_comunas(id) ON DELETE CASCADE,

  -- Tipo de propiedad tal como lo segmenta la URL de listado de Portal
  -- Inmobiliario (casa | departamento | terreno | oficina | ...). Texto libre
  -- a propósito (ver cabecera): casas primero, el resto se suma sin migrar.
  property_type          text NOT NULL DEFAULT 'casa',
  operation              text NOT NULL CHECK (operation IN ('sale','rent')),

  -- Interruptor de barrido. Arranca en false para toda la RM; solo Las Condes
  -- se siembra en true (ver INSERT al final). Activar más comunas = UPDATE.
  enabled                boolean NOT NULL DEFAULT false,

  -- Cadencia de barrido para esta comuna (decisión #3: 8h por defecto).
  -- Ajustable por comuna (comunas de alto volumen podrían querer intervalos más
  -- cortos, o al revés bajar la frecuencia de comunas periféricas de bajo stock).
  interval_hours         integer NOT NULL DEFAULT 8 CHECK (interval_hours > 0),

  -- Prioridad de encolado (menor = antes). El worker ordena por priority cuando
  -- hay más objetivos vencidos que capacidad en un ciclo. Se siembra 10 para las
  -- comunas ya marcadas `priority=true` en chile_comunas (barrio alto), 100 al
  -- resto — así el orden de escalado ya queda insinuado en los datos.
  priority               integer NOT NULL DEFAULT 100,

  -- ── Observabilidad / cobertura (H17, H22) ────────────────────────────────
  -- Última vez que el discovery corrió este objetivo (éxito o no) y última vez
  -- que terminó bien. El dead-man switch de H17 alerta si `last_run_at` de una
  -- comuna enabled queda más viejo que 2 × interval_hours.
  last_run_at            timestamptz,
  last_success_at        timestamptz,
  -- Nº de anuncios que el último barrido encontró para esta comuna, y el
  -- contador que el propio portal declara para la misma búsqueda (ej. 3.741 en
  -- Las Condes). El gate de éxito (H22) exige cobertura ≥90% =
  -- last_listing_count / portal_reported_count antes de escalar a más comunas.
  last_listing_count     integer,
  portal_reported_count  integer,

  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- Un objetivo por combinación comuna+tipo+operación (idempotencia del seed y
  -- del upsert del worker).
  UNIQUE (comuna_id, property_type, operation)
);

-- Cola de trabajo del worker: objetivos activos, ordenados por prioridad y por
-- lo más atrasado (last_run_at NULL = nunca corrido, va primero con NULLS FIRST).
CREATE INDEX IF NOT EXISTS idx_scrape_targets_cl_due
  ON scrape_targets_cl(priority, last_run_at NULLS FIRST) WHERE enabled;
CREATE INDEX IF NOT EXISTS idx_scrape_targets_cl_comuna
  ON scrape_targets_cl(comuna_id);

-- ─── Seed: toda la RM × casa × {venta, arriendo}, solo Las Condes activa ─────
-- INSERT ... SELECT desde chile_comunas para no repetir a mano las ~52 comunas.
-- Idempotente (ON CONFLICT DO NOTHING): re-aplicar la migración no duplica ni
-- pisa el estado `enabled` que el usuario haya cambiado luego a mano.
INSERT INTO scrape_targets_cl (comuna_id, property_type, operation, enabled, priority)
SELECT
  c.id,
  'casa',
  op.operation,
  (c.name = 'Las Condes'),                        -- solo Las Condes arranca activa
  CASE WHEN c.priority THEN 10 ELSE 100 END        -- barrio alto = prioridad alta
FROM chile_comunas c
CROSS JOIN (VALUES ('sale'), ('rent')) AS op(operation)
WHERE c.region = 'Región Metropolitana de Santiago'
ON CONFLICT (comuna_id, property_type, operation) DO NOTHING;
