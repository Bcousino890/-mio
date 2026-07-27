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
