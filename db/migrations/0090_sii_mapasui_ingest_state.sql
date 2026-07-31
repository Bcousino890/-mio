-- ─────────────────────────────────────────────────────────────────────────────
-- 0090 · Estado de la ingesta de predios mapasui (checkpoint por archivo)
-- ─────────────────────────────────────────────────────────────────────────────
-- El cron de respaldo (ingest-sii-mapasui-now.yml, cada 30 min) y la ingesta
-- incremental de run-sii-mapasui.sh re-leían ENTERO cada
-- output/predios/*.jsonl y hacían un UPSERT por línea. Con Las Condes ya en
-- 340k predios eso son 340k round-trips a Postgres por corrida: tardaba más de
-- 5 minutos SIN escribir nada en el canal SSH, y el túnel se caía a la mitad
-- ("client_loop: send disconnect: Broken pipe", exit 255). El workflow llevaba
-- días fallando casi en cada corrida y la tabla se quedaba con lo poco que
-- alcanzaba a entrar antes del corte.
--
-- Esta tabla guarda hasta qué BYTE de cada .jsonl se ingestó ya, de modo que
-- cada corrida solo lea las líneas NUEVAS (el scraper solo appendea). Se
-- actualiza dentro de la misma transacción que el lote de predios, así que el
-- offset nunca adelanta a los datos: si la corrida muere a la mitad, la
-- siguiente retoma exactamente donde quedó.
--
-- La clave es el BASENAME del archivo ("las_condes.jsonl"), no la ruta: el
-- mismo archivo se ingesta con rutas distintas según quién llame
-- (run-sii-mapasui.sh usa output/predios/, el workflow usa
-- sii-scraper/output/predios/) y ambas deben compartir checkpoint.
--
-- Además es el latido REAL del pipeline para /chile/sii-mapasui: antes el
-- panel deducía "última ingesta" del updated_at de los predios, que el upsert
-- bumpea aunque el lote no traiga nada nuevo — con la ingesta incremental ya
-- no se reescriben filas viejas, así que el latido tiene que vivir acá.

CREATE TABLE IF NOT EXISTS sii_mapasui_ingest_state_cl (
  archivo         text PRIMARY KEY,          -- basename del .jsonl, ej. "las_condes.jsonl"
  byte_offset     bigint NOT NULL DEFAULT 0, -- byte hasta el que ya se ingestó (siempre en frontera de línea)
  file_size       bigint NOT NULL DEFAULT 0, -- tamaño del archivo en la última corrida
  lineas          bigint NOT NULL DEFAULT 0, -- líneas leídas acumuladas
  predios         bigint NOT NULL DEFAULT 0, -- registros upserted acumulados
  lineas_invalidas bigint NOT NULL DEFAULT 0,-- líneas completas que no parsearon (JSONL corrupto)
  ultima_corrida  timestamptz NOT NULL DEFAULT now(), -- última vez que el ingest MIRÓ este archivo
  ultimo_avance   timestamptz,               -- última vez que trajo líneas nuevas
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
