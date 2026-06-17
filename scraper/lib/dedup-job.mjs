import pg from 'pg';
import { calculateMatchScore, makeDecision } from './matching.mjs';
import { clusterMatchedListings } from './clustering.mjs';

const { Client } = pg;

/**
 * Job de deduplicación: procesa listings nuevos o sin agrupar.
 * Busca candidatos con blocking, calcula scores, y hace matching.
 * Periódicamente (cada N candidatos confirmados) ejecuta clustering.
 *
 * @param {object} options - {db_url, weights, thresholds, max_batch_size, cluster_interval}
 */
export async function runDedupJob(options = {}) {
  const {
    db_url = process.env.DATABASE_URL,
    weights = undefined, // usar defaults de matching.mjs
    thresholds = { auto: 0.90, review_min: 0.75 },
    max_batch_size = 1000,
    cluster_interval = 500 // re-cluster cada 500 matches confirmados
  } = options;

  if (!db_url) throw new Error('DATABASE_URL required');

  const client = new Client({ connectionString: db_url });
  await client.connect();

  try {
    console.log('[dedup-job] iniciando...');

    // Actualizar estado del job
    await updateJobState(client, 'dedup-matching', 'running');

    let candidates_found = 0;
    let candidates_matched = 0;
    let batch = [];

    // Buscar listings activos sin property_id (sin agrupar aún)
    const unmatched = await client.query(`
      SELECT id, portal, external_id
      FROM listings
      WHERE property_id IS NULL AND is_active
      ORDER BY last_seen_at DESC
      LIMIT $1
    `, [max_batch_size]);

    console.log(`[dedup-job] procesando ${unmatched.rows.length} listings sin agrupar`);

    for (const listing of unmatched.rows) {
      // Encontrar candidatos compatibles via blocking
      const candidateResult = await client.query(
        'SELECT * FROM find_match_candidates($1, 150, 0.08)',
        [listing.id]
      );

      for (const candidate of candidateResult.rows) {
        // Calcular señales atómicas
        const signalsResult = await client.query(
          'SELECT calculate_match_signals($1, $2) AS signals',
          [listing.id, candidate.candidate_id]
        );

        const signals = signalsResult.rows[0]?.signals;
        if (!signals) continue;

        // Aplicar scoring
        const { score, components } = calculateMatchScore(signals, weights);
        const { status, decided_by, reason } = makeDecision(score, thresholds);

        // Preparar para inserción (ordenar a<b para UNIQUE)
        const [a, b] = listing.id < candidate.candidate_id
          ? [listing.id, candidate.candidate_id]
          : [candidate.candidate_id, listing.id];

        batch.push({
          listing_a: a,
          listing_b: b,
          score,
          signals: JSON.stringify({ ...signals, score, reason }),
          status,
          decided_by,
          decision_reason: reason
        });

        if (status === 'confirmed') {
          candidates_matched++;
        }
        candidates_found++;
      }
    }

    // Insertar todos los matches en lote
    if (batch.length > 0) {
      await insertMatches(client, batch);
      console.log(`[dedup-job] insertados ${batch.length} matches (${candidates_matched} confirmados)`);
    }

    // Si se acumulan suficientes matches confirmados, ejecutar clustering
    if (candidates_matched >= cluster_interval) {
      console.log('[dedup-job] ejecutando clustering...');
      await clusterMatchedListings(client);
    }

    // Actualizar estado del job
    await updateJobState(client, 'dedup-matching', 'idle', null, {
      candidates_found,
      candidates_matched
    });

    console.log('[dedup-job] completado');
    return { candidates_found, candidates_matched };
  } catch (error) {
    console.error('[dedup-job] error:', error.message);
    await updateJobState(client, 'dedup-matching', 'failed', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Inserta lote de matches en la BD.
 * Ignora conflicts (mismo par ya evaluado).
 */
async function insertMatches(client, matches) {
  const values = matches.map((m, i) => {
    const offset = i * 8;
    return `(
      gen_random_uuid(),
      $${offset + 1}::uuid,
      $${offset + 2}::uuid,
      $${offset + 3}::numeric,
      $${offset + 4}::jsonb,
      $${offset + 5}::text,
      $${offset + 6}::text,
      now()
    )`;
  });

  const params = matches.flatMap(m => [
    m.listing_a,
    m.listing_b,
    m.score,
    m.signals,
    m.status,
    m.decided_by
  ]);

  const query = `
    INSERT INTO listing_match (
      id, listing_a, listing_b, score, signals, status, decided_by, created_at
    ) VALUES ${values.join(', ')}
    ON CONFLICT (listing_a, listing_b) DO UPDATE SET
      score = EXCLUDED.score,
      signals = EXCLUDED.signals,
      status = EXCLUDED.status,
      decided_by = EXCLUDED.decided_by,
      updated_at = now()
  `;

  // Postgres tiene un límite de 65535 parámetros, split si es necesario
  const maxParams = 8; // 8 parámetros por match
  for (let i = 0; i < matches.length; i += maxParams) {
    const batch = matches.slice(i, i + maxParams);
    const batchValues = batch.map((m, j) => {
      const offset = j * 8;
      return `(
        gen_random_uuid(),
        $${offset + 1}::uuid,
        $${offset + 2}::uuid,
        $${offset + 3}::numeric,
        $${offset + 4}::jsonb,
        $${offset + 5}::text,
        $${offset + 6}::text,
        now()
      )`;
    });
    const batchParams = batch.flatMap(m => [
      m.listing_a,
      m.listing_b,
      m.score,
      m.signals,
      m.status,
      m.decided_by
    ]);
    const batchQuery = `
      INSERT INTO listing_match (
        id, listing_a, listing_b, score, signals, status, decided_by, created_at
      ) VALUES ${batchValues.join(', ')}
      ON CONFLICT (listing_a, listing_b) DO UPDATE SET
        score = EXCLUDED.score,
        signals = EXCLUDED.signals,
        status = EXCLUDED.status,
        decided_by = EXCLUDED.decided_by,
        updated_at = now()
    `;
    await client.query(batchQuery, batchParams);
  }
}

/**
 * Actualiza el estado del job en la tabla dedup_job_state.
 */
async function updateJobState(client, jobName, status, lastError = null, stats = {}) {
  const { candidates_found = 0, candidates_matched = 0 } = stats;
  await client.query(`
    INSERT INTO dedup_job_state (job_name, status, last_error, last_run_at, updated_at, candidates_found, candidates_matched)
    VALUES ($1, $2, $3, now(), now(), $4, $5)
    ON CONFLICT (job_name) DO UPDATE SET
      status = EXCLUDED.status,
      last_error = EXCLUDED.last_error,
      last_run_at = EXCLUDED.last_run_at,
      updated_at = EXCLUDED.updated_at,
      candidates_found = EXCLUDED.candidates_found,
      candidates_matched = EXCLUDED.candidates_matched
  `, [jobName, status, lastError, candidates_found, candidates_matched]);
}
