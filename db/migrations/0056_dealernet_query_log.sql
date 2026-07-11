-- ─────────────────────────────────────────────────────────────────────────────
-- 0056 · Bitácora de consultas DealerNet (append-only, auditoría de gasto)
-- ─────────────────────────────────────────────────────────────────────────────
-- Las tablas de caché (dealernet_contacts_cl, dealernet_buscador_multiple_cl)
-- guardan el RESULTADO más reciente por RUT / (tipbusq, args), pero lo
-- sobrescriben (upsert) — no dejan historial de CUÁNDO y DESDE DÓNDE se
-- consultó, ni distinguen una consulta en vivo (que cuesta plata) de una
-- servida desde caché. Esta tabla es el registro append-only de toda consulta
-- DealerNet: 1 fila por request, nunca se actualiza ni se borra. Sirve para
-- auditar el gasto (cuántas consultas EN VIVO se hicieron, de qué tipo, desde
-- qué flujo) y para conciliar contra la facturación del proveedor.

CREATE TABLE IF NOT EXISTS dealernet_query_log_cl (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'buscador_multiple' (producto 3460) | 'contactos_rut' (3407/3408/3410) | 'debug'
  kind           text NOT NULL,
  -- Buscador Múltiple:
  tipbusq        text,
  args           text,
  -- Consulta por RUT:
  rut_num        bigint,
  rut_dv         text,
  product_codes  text[],
  -- Resultado:
  retcode        int,
  success        boolean NOT NULL,
  from_cache     boolean NOT NULL DEFAULT false,  -- true = servida de caché (NO costó consulta)
  candidatos_n   int,                             -- nº de candidatos/registros devueltos (si aplica)
  source         text,                            -- flujo que la originó: 'ficha_catastro' | 'dealer' | 'captacion' | 'debug'
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Consultas en vivo por fecha (auditoría de gasto): el índice parcial deja
-- fuera las servidas de caché, que no cuestan.
CREATE INDEX IF NOT EXISTS idx_dealernet_query_log_live_created
  ON dealernet_query_log_cl (created_at DESC)
  WHERE from_cache = false;

CREATE INDEX IF NOT EXISTS idx_dealernet_query_log_rut
  ON dealernet_query_log_cl (rut_num, rut_dv)
  WHERE rut_num IS NOT NULL;
