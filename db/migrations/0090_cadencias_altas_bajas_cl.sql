-- Separa la cadencia de ALTAS de la de BAJAS.
--
-- Hasta ahora había una sola: el barrido completo cada 8 h hacía las dos cosas.
-- Eso obliga a elegir entre detectar altas rápido (barrer seguido, carísimo) o
-- no saturar (barrer poco, altas con horas de retraso). Son dos necesidades
-- distintas y ahora tienen dos mecanismos distintos:
--
--   ALTAS → barrido de CABECERA, cada 30 min entre las 8:00 y las 23:00 de
--           Chile. El listado se pide ordenado por más reciente, así que lo
--           recién publicado está en la primera página: no hace falta recorrer
--           la comuna entera. ~4 MB por pasada frente a los ~235 MB de un
--           barrido completo. Vive en el worker (discovery-head-scheduler-cl),
--           no en esta tabla, porque su cadencia es global y no por comuna.
--
--   BAJAS → barrido COMPLETO, que es el único que puede saber qué desapareció
--           (hay que ver la comuna entera para echar en falta algo). Pasa de
--           8 h a 24 h: es lo que se decidió y el coste se divide por tres.
--
-- El efecto conjunto sobre el VPS es lo que se buscaba: el barrido completo
-- pasa de 3 pasadas diarias a 1, y las altas dejan de depender de él.

UPDATE scrape_targets_cl SET interval_hours = 24 WHERE interval_hours < 24;

COMMENT ON COLUMN scrape_targets_cl.interval_hours IS
  'Cadencia del barrido COMPLETO (altas + bajas). Las altas por separado van por el barrido de cabecera del worker, cada 30 min en ventana horaria chilena.';
