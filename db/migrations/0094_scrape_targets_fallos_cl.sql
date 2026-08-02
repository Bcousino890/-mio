-- ─────────────────────────────────────────────────────────────────────────────
-- 0094 · scrape_targets_cl: distinguir "barrido hecho" de "barrido que ni pudo
--        empezar".
-- ─────────────────────────────────────────────────────────────────────────────
-- Hasta ahora `last_run_at` se escribía SIEMPRE al terminar un discovery, aunque
-- el barrido no hubiera llegado a leer ni una sola página (proxy caído, circuito
-- abierto, bloqueo del portal). Consecuencias medidas en producción:
--
--   1. Un fallo de red de 60 segundos consumía las 24 h de cadencia del objetivo
--      (`selectDueTargets` filtra por last_run_at), así que la comuna quedaba sin
--      barrer un día entero por un problema que ya se había resuelto solo.
--   2. Como el scheduler encola TODOS los objetivos vencidos de golpe y el
--      circuit-breaker es por dominio, el primer fallo abría el circuito y los
--      demás objetivos se "gastaban" en milisegundos, sin una sola petición.
--   3. El panel de salud pintaba "al día" (verde) porque solo miraba
--      `last_run_at` — que el fallo acababa de actualizar. Es decir: el
--      indicador se ponía verde precisamente por haber fallado.
--
-- Con estas dos columnas el fallo tiene dónde anotarse SIN tocar `last_run_at`:
-- el objetivo sigue vencido (se reintenta en el siguiente ciclo de 15 min, no en
-- 24 h) y el panel puede decir la verdad ("fallando, N intentos seguidos").

ALTER TABLE scrape_targets_cl
  ADD COLUMN IF NOT EXISTS last_failure_at      timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN scrape_targets_cl.last_failure_at IS
  'Último intento de barrido que no consiguió leer NI UNA página (red/proxy/bloqueo). No mueve last_run_at: el objetivo sigue vencido y se reintenta en el siguiente ciclo.';
COMMENT ON COLUMN scrape_targets_cl.consecutive_failures IS
  'Intentos bloqueados seguidos. Vuelve a 0 en cuanto un barrido consigue leer aunque sea una página. >0 = el panel muestra el objetivo como "fallando".';

-- Los objetivos que quedaron con `last_run_at` de un barrido bloqueado (0
-- anuncios vistos y una nota de fallo de red) tienen la cadencia quemada: no se
-- volverían a barrer hasta 24 h después de un intento que nunca leyó nada. Se
-- liberan aquí para que el worker los retome en el siguiente ciclo, en vez de
-- esperar a que el usuario pulse "Forzar re-barrido".
UPDATE scrape_targets_cl
   SET last_run_at = NULL,
       consecutive_failures = 1,
       last_failure_at = last_run_at
 WHERE enabled
   AND COALESCE(last_listing_count, 0) = 0
   AND notes IS NOT NULL
   AND (notes LIKE 'fetch p%' OR notes LIKE '%circuit_open%');
