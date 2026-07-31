-- Versión del parser con la que se leyó cada ficha, para que un arreglo del
-- parser re-encole solo lo afectado sin escribir una migración a mano.
--
-- Hasta ahora, cada vez que corregíamos parse-portalinmobiliario.mjs (fotos que
-- no eran fotos, superficies imposibles, moneda no soportada…) había que
-- escribir una migración específica que re-encolara las fichas afectadas
-- (0087, 0088, 0089). Funciona, pero depende de acordarse cada vez y de acotar
-- bien qué fichas tocaba. Con esta columna, el próximo arreglo solo necesita
-- subir CURRENT_PARSER_VERSION (parse-portalinmobiliario.mjs) — el mantenimiento
-- de colas encuentra solo a quien quedó atrás y lo re-encola él solo.
--
-- Las ~15.900 fichas existentes quedan en NULL (nunca leídas con versión): la
-- cola de mantenimiento las trata como "versión vieja" y las re-scrapea en un
-- barrido acotado (400 cada 15 min → el catálogo entero en menos de un día,
-- una sola vez). Es, de hecho, la limpieza de todo lo que quedó de antes de
-- versionar el parser — el "que todo esté siempre correcto" que se pidió como
-- prioridad, hecho automático de aquí en adelante.

ALTER TABLE listings_cl ADD COLUMN IF NOT EXISTS parser_version integer;

COMMENT ON COLUMN listings_cl.parser_version IS
  'Versión de parse-portalinmobiliario.mjs con la que se leyó esta ficha. NULL = de antes de versionar. Un arreglo del parser sube CURRENT_PARSER_VERSION y el mantenimiento de colas re-encola solo lo que quedó atrás.';

CREATE INDEX IF NOT EXISTS idx_listings_cl_parser_version
  ON listings_cl (parser_version)
  WHERE is_active;
