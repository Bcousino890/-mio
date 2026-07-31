-- Resumen por comuna del catastro SII, precalculado.
--
-- /chile daba TIMEOUT (30 s) mientras el resto de la app respondía en ~1 s: la
-- página calculaba el desglose por comuna en CADA request con un GROUP BY sobre
-- los ~9,6M de roles de sii_roles_cl, aplicando 3 regex POSIX por fila más un
-- COUNT(DISTINCT regexp_replace(direccion, ...)) que obliga a ordenar millones
-- de textos. Tenía una caché en memoria de 1 h, pero nunca se poblaba: la
-- consulta no terminaba dentro del timeout del request, así que cada visita
-- volvía a lanzarla desde cero. Peor: el pool de la app son 10 conexiones
-- (web/lib/db.ts), así que varias visitas seguidas apilaban varias copias del
-- mismo escaneo de 9,6M de filas y dejaban sin conexiones al resto del CRM.
--
-- La cura es materializar el resumen aquí: la página hace un SELECT trivial
-- contra esta tabla (~350 filas) y el cálculo caro corre fuera del request,
-- como máximo una vez cada TTL.
--
-- Esta migración crea SOLO el esquema; no calcula nada. Dos razones:
--   · Las expresiones regulares que distinguen depto/edificio viven en
--     web/lib/sii-edificio-sql.ts y son la única definición del criterio.
--     Copiarlas aquí garantizaría que un día divergieran.
--   · post-deploy.sh aborta el deploy si una migración falla y no le pone
--     timeout: meter aquí un cálculo de minutos sobre 9,6M de filas pondría el
--     deploy a competir con el reinicio de la app en el mismo VPS compartido.
-- La puebla la app en segundo plano (web/lib/sii-comuna-resumen.ts), fuera del
-- ciclo de request, y se refresca sola cuando queda obsoleta.

CREATE TABLE IF NOT EXISTS sii_resumen_comuna_cl (
  sii_comuna_code  text PRIMARY KEY,
  roles            integer     NOT NULL DEFAULT 0,
  casas            integer     NOT NULL DEFAULT 0,
  departamentos    integer     NOT NULL DEFAULT 0,
  edificios        integer     NOT NULL DEFAULT 0,
  sitios           integer     NOT NULL DEFAULT 0,
  bodegas          integer     NOT NULL DEFAULT 0,
  estacionamientos integer     NOT NULL DEFAULT 0,
  oficinas         integer     NOT NULL DEFAULT 0,
  comercio         integer     NOT NULL DEFAULT 0,
  agricolas        integer     NOT NULL DEFAULT 0,
  computed_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sii_resumen_comuna_cl IS
  'Desglose por comuna de sii_roles_cl, precalculado. Lo refresca la app (web/lib/sii-comuna-resumen.ts) fuera del ciclo de request; /chile solo lee.';
