-- ─────────────────────────────────────────────────────────────────────────────
-- 0081 · Fusión EXPLÍCITA de corredoras que operan con varias cuentas
-- ─────────────────────────────────────────────────────────────────────────────
-- corredoras_cl guarda una fila por `advertiser_id` (cuenta de vendedor de
-- Mercado Libre), pero una misma corredora publica con varias: Property Partners
-- usa 4 y aparecía partida en fichas de 288/50/47/… mientras el portal la
-- muestra entera.
--
-- Fusionar automáticamente por nombre parece la solución obvia y es UN ERROR:
-- probado sobre los datos reales, agrupaba 7 conjuntos y solo uno era correcto.
--   · "Sin Información" (3 cuentas) — el nombre es un placeholder: son tres
--     vendedores sin relación entre sí.
--   · "Felipe", "Cristian" (2 cada uno) — nombres de pila; personas distintas.
--   · Y el caso que más daño haría: las franquicias (Coldwell Banker, Engel &
--     Völkers, RE/MAX) son oficinas INDEPENDIENTES con el mismo nombre. Unirlas
--     falsearía el stock, la rotación y la exclusividad de cada una, que es
--     justo lo que este módulo mide.
--
-- Por eso la fusión es una decisión explícita, fila a fila. Añadir una corredora
-- = un INSERT aquí; nada se une solo.

CREATE TABLE IF NOT EXISTS corredora_merge_names_cl (
  name_normalized text PRIMARY KEY,
  nota            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE corredora_merge_names_cl IS
  'Corredoras cuyas cuentas de vendedor SÍ se unifican en una sola ficha. Fusión explícita: lo que no está aquí, no se fusiona.';

INSERT INTO corredora_merge_names_cl (name_normalized, nota)
VALUES ('Property Partners', 'Opera con 4 cuentas de vendedor en Portal Inmobiliario; el portal la lista como una sola (~290 anuncios).')
ON CONFLICT (name_normalized) DO NOTHING;
