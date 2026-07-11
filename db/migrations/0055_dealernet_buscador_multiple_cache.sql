-- ─────────────────────────────────────────────────────────────────────────────
-- 0055 · Caché del Buscador Múltiple DealerNet (producto 3460)
-- ─────────────────────────────────────────────────────────────────────────────
-- Cada consulta a DealerNet (Buscador Múltiple o por RUT) tiene costo. Hasta
-- ahora dealernet-buscar (Buscador Múltiple, tipbusq=nombre/rol/direccion/...)
-- NO persistía nada — cada búsqueda repetida por rol/dirección/nombre volvía
-- a golpear el web service y a gastar plata, a diferencia de dealernet-lookup
-- (por RUT), que sí guarda en dealernet_contacts_cl. Esta tabla cierra ese
-- hueco: 1 fila por (tipbusq, args normalizado) — la próxima búsqueda idéntica
-- se sirve desde acá en vez de volver a consultar DealerNet.

CREATE TABLE IF NOT EXISTS dealernet_buscador_multiple_cl (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipbusq       text NOT NULL,   -- 'nombre' | 'empresa' | 'ambas_peremp' | 'telefono' | 'direccion' | 'rol' | 'patente'
  args          text NOT NULL,   -- normalizado (ver normalizeBuscadorMultipleArgs en web/lib/dealernet.ts)
  retcode       int,
  retmsg        text,
  candidatos    jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_response  jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tipbusq, args)
);

CREATE OR REPLACE FUNCTION dealernet_buscador_multiple_cl_touch_updated_at()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dealernet_buscador_multiple_cl_touch ON dealernet_buscador_multiple_cl;
CREATE TRIGGER trg_dealernet_buscador_multiple_cl_touch
  BEFORE UPDATE ON dealernet_buscador_multiple_cl
  FOR EACH ROW EXECUTE FUNCTION dealernet_buscador_multiple_cl_touch_updated_at();
