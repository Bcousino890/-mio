#!/usr/bin/env node
/**
 * Runner para el job de deduplicación.
 * Procesa listings sin agrupar y ejecuta clustering periódicamente.
 *
 * Uso:
 *   node dedup-runner.mjs
 *   DATABASE_URL=... node dedup-runner.mjs
 */

import { runDedupJob } from './lib/dedup-job.mjs';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('✗ Falta DATABASE_URL');
    process.exit(1);
  }

  try {
    const result = await runDedupJob({
      db_url: process.env.DATABASE_URL,
      max_batch_size: 1000,
      cluster_interval: 500,
    });

    console.log(`✅ Job completado: ${result.candidates_found} candidatos, ${result.candidates_matched} matches`);
    process.exit(0);
  } catch (error) {
    console.error(`✗ Error en job: ${error.message}`);
    process.exit(1);
  }
}

main();
