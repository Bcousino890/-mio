// ─────────────────────────────────────────────────────────────────────────────
// Mantenimiento de las colas de pg-boss (Anuncios CL).
//
// El discovery encola una ficha por cada anuncio que ve y que aún no está en
// listings_cl. Como `boss.send` crea un job NUEVO en cada llamada, cada barrido
// volvía a encolar los mismos anuncios: la cola detail-cl llegó a 46.797 jobs
// pendientes para ~3.700 anuncios reales (≈14 barridos apilados). Con ese
// atasco, un anuncio nuevo quedaba detrás de decenas de miles de duplicados y
// tardaba días en entrar — por eso el contador de anuncios crudos se quedaba
// clavado mientras el barrido reportaba miles de vistos.
//
// La prevención va en el `send` (singletonKey por anuncio, ver worker-cl.mjs).
// Esto es la cura del atasco ya acumulado, y la red por si algún camino vuelve
// a encolar sin clave: deja UN job pendiente por entidad y borra el resto.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adelanta en la cola las fichas de anuncios que TODAVÍA NO están en la base.
 *
 * pg-boss sirve por prioridad y, a igualdad, por antigüedad. La cola arrastra
 * miles de jobs viejos, encolados cuando esos anuncios aún no existían y que hoy
 * solo los REFRESCAN (ya están guardados). Los anuncios que de verdad faltan se
 * encolaron después, así que quedan al final: a ~15 fichas/min hay horas de cola
 * vieja por delante y el catálogo no crece. Medido: la cola bajaba de 3.475 a
 * 3.416 sin una sola alta.
 *
 * No se borran los jobs viejos a propósito: al refrescar anuncios ya guardados
 * son, hoy por hoy, lo único que detecta cambios de precio y bajas. Solo se
 * reordena: primero lo que falta, después lo que ya está.
 *
 * Idempotente: solo escribe los jobs cuya prioridad aún no es la correcta.
 */
export async function prioritizeMissingDetailJobsCl(client, { priority = 100 } = {}) {
  try {
    const { rowCount } = await client.query(
      `UPDATE pgboss.job j
       SET priority = $1
       WHERE j.name = 'detail-cl' AND j.state = 'created' AND j.priority < $1
         AND NOT EXISTS (
           SELECT 1 FROM listings_cl l
           WHERE l.portal = 'portalinmobiliario'
             AND l.external_id = j.data->>'externalId'
         )`,
      [priority]
    )
    return { prioritized: rowCount ?? 0 }
  } catch (e) {
    return { error: e.message }
  }
}

/** Clave de deduplicación por cola: qué campo de `data` identifica la entidad. */
const DEDUP_KEY_BY_QUEUE = {
  'detail-cl': 'externalId',
  'media-sync-cl': 'listingId',
}

/**
 * Deja un único job PENDIENTE por entidad en cada cola. Solo toca `state =
 * 'created'`: nunca los que pg-boss está ejecutando (`active`) ni el histórico.
 * Idempotente — en una cola ya limpia borra 0 filas.
 *
 * @returns {Promise<Record<string, number>>} jobs borrados por cola
 */
export async function pruneDuplicateJobsCl(client, queues = DEDUP_KEY_BY_QUEUE) {
  const deleted = {}
  for (const [queue, key] of Object.entries(queues)) {
    try {
      const { rowCount } = await client.query(
        `DELETE FROM pgboss.job
         WHERE name = $1 AND id IN (
           SELECT id FROM (
             SELECT id, row_number() OVER (
               PARTITION BY data->>$2 ORDER BY created_on DESC
             ) AS rn
             FROM pgboss.job
             WHERE name = $1 AND state = 'created' AND data->>$2 IS NOT NULL
           ) t WHERE t.rn > 1
         )`,
        [queue, key]
      )
      deleted[queue] = rowCount ?? 0
    } catch (e) {
      // pg-boss puede no haber creado aún el esquema, o cambiar de versión: el
      // mantenimiento nunca debe tumbar el pipeline que lo invoca.
      deleted[queue] = `error: ${e.message}`
    }
  }
  return deleted
}

/**
 * Re-encola, por tandas, las fichas que llevan más tiempo sin bajarse enteras.
 *
 * Nació como backfill de los anuncios scrapeados antes de arreglar el parser,
 * y elegía por sus dos rastros: exactamente 5 fotos (el blob de la ficha trae
 * 5 pase lo que pase; el resto vive detrás del modal de galería, que antes no
 * se pedía) y advertiser_name vacío o genérico ("Corredora").
 *
 * Ese criterio NO CONVERGÍA. Un anuncio que de verdad tiene 3 fotos lo cumple
 * para siempre: se re-scrapeaba, seguía teniendo 3, y volvía a entrar en la
 * tanda siguiente. Medido en producción: el 6% del catálogo (74 de 1.200 con
 * 1-4 fotos) girando en bucle, ~19.000 descargas diarias que no cambian un solo
 * dato, gastando GB del proxy residencial y dando motivos al portal para volver
 * a bloquear la IP — ya devolvió 403 una vez.
 *
 * Ahora se ordena por `detail_parsed_at` (migración 0085): la ficha que lleva
 * más tiempo sin abrirse va primero, y al re-scrapearse se actualiza su fecha y
 * pasa al final. Los anuncios del parser viejo lo tienen NULL, así que siguen
 * entrando los primeros; después el catálogo rota entero a ritmo acotado, que
 * de paso es lo único que detecta bajadas de precio en anuncios ya guardados
 * (el discovery solo encola el detalle de los que aún NO están en la base).
 *
 * Delante de todo van las fichas INCOMPLETAS: les falta algo que un anuncio
 * scrapeado bien siempre debería tener — fotos (según `photos_total_count`,
 * migración 0086), ubicación, corredora con nombre real, código de la
 * propiedad en el portal, descripción, características o superficie. Es la
 * prioridad 1 del sistema: que cada ficha tenga todo lo que el portal da.
 *
 * Ese "delante de todo" se limita a una vez cada 24 h por ficha, y no es un
 * detalle: HAY huecos que no se pueden cerrar nunca. Verificado contra el
 * portal en MLC-4191870754 — declara 30 fotos y la unión de sus dos únicas
 * fuentes (el blob de la ficha y el modal de galería) da 29. La foto número 30
 * no existe en ningún sitio al que se pueda llegar. Sin el límite temporal esas
 * fichas encabezarían la cola en cada pasada, para siempre — el mismo bucle
 * que este cambio vino a quitar. Con el límite cuestan un re-scrapeo al día;
 * si el portal llega a publicarlo, se recoge dentro de esas 24 h.
 *
 * No se exige `property_code`/`seller_reference` de forma absoluta a propósito:
 * un tercio del catálogo no trae código interno porque la corredora nunca lo
 * puso, no porque se perdiera al scrapear — exigirlo perseguiría un hueco que
 * no existe. Si algún día se mide que `property_code` SÍ es universal, se
 * puede sumar aquí con el mismo criterio.
 *
 * Después de las incompletas van las de PARSER VIEJO: `parser_version`
 * (migración 0091) sube cada vez que un arreglo del parser puede corregir
 * datos ya guardados (fotos que no eran fotos, superficies imposibles…). Antes
 * cada arreglo necesitaba su propia migración que re-encolara a mano (0087,
 * 0088, 0089); ahora basta con subir CURRENT_PARSER_VERSION y esta cola
 * encuentra sola a quien quedó atrás. No necesita el freno de 24 h: en cuanto
 * se re-lee, la ficha queda con la versión actual y no vuelve a entrar por
 * este motivo — a diferencia de un hueco de datos, "versión vieja" siempre se
 * puede cerrar con solo pedir la página otra vez.
 *
 * Por último, la ROTACIÓN normal: `detail_parsed_at` (migración 0085), la
 * ficha que lleva más tiempo sin abrirse va primero. Es lo único que detecta
 * rebajas de precio en anuncios ya guardados (el discovery solo encola el
 * detalle de los que aún NO están en la base).
 *
 * NO se usa `last_seen_at` para ordenar: lo mueve también el barrido del
 * listado, que ve el anuncio sin abrir su ficha.
 *
 * Prioridad NORMAL (0), por debajo de los anuncios que aún no existen en la
 * base (prioridad 100): completar el catálogo va antes que refrescarlo.
 *
 * Idempotente: no re-encola lo que ya está pendiente o ejecutándose.
 *
 * @param {number} [opts.currentParserVersion] - CURRENT_PARSER_VERSION del
 *   parser (parse-portalinmobiliario.mjs), inyectado por el caller para no
 *   crear una dependencia circular entre el parser y el mantenimiento de colas.
 */
export async function reenqueueStaleListingsCl(client, { limit = 400, currentParserVersion = null } = {}) {
  try {
    const { rowCount } = await client.query(
      `INSERT INTO pgboss.job (name, data, priority)
       SELECT 'detail-cl',
              jsonb_build_object('externalId', l.external_id, 'sourceUrl', l.source_url),
              0
       FROM listings_cl l
       WHERE l.portal = 'portalinmobiliario'
         AND l.is_active
         AND l.source_url IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM pgboss.job j
           WHERE j.name = 'detail-cl' AND j.state IN ('created', 'active')
             AND j.data->>'externalId' = l.external_id
         )
       ORDER BY CASE
                  WHEN (l.detail_parsed_at IS NULL OR l.detail_parsed_at < now() - interval '24 hours')
                    AND (
                      (jsonb_typeof(l.photos) = 'array' AND l.photos_total_count IS NOT NULL
                         AND jsonb_array_length(l.photos) < l.photos_total_count)
                      OR l.address IS NULL
                      OR l.latitude IS NULL OR l.longitude IS NULL
                      OR l.advertiser_name IS NULL OR btrim(l.advertiser_name) = ''
                         OR lower(btrim(l.advertiser_name)) = 'corredora'
                      OR l.description IS NULL OR btrim(l.description) = ''
                      -- CASE, no jsonb_typeof(...) <> 'array' OR jsonb_array_length(...):
                      -- Postgres NO garantiza el orden de evaluación de un OR, y
                      -- jsonb_array_length() lanza excepción sobre un jsonb que no
                      -- sea array. Con CASE la rama que llama a la función solo se
                      -- evalúa cuando ya se comprobó que sí es un array.
                      OR (CASE WHEN jsonb_typeof(l.features) = 'array'
                               THEN jsonb_array_length(l.features) = 0
                               ELSE true END)
                      OR l.square_meters IS NULL
                    )
                  THEN 0
                  WHEN l.parser_version IS NULL
                    OR ($2::int IS NOT NULL AND l.parser_version < $2)
                  THEN 1
                  ELSE 2
                END,
                l.detail_parsed_at ASC NULLS FIRST
       LIMIT $1`,
      [limit, currentParserVersion]
    )
    return { reenqueued: rowCount ?? 0 }
  } catch (e) {
    return { error: e.message }
  }
}
