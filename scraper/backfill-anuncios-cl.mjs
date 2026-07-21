#!/usr/bin/env node
/**
 * Backfill de Anuncios CL (plan Anuncios CL · Fase 1 · H22).
 *
 * Corre Nivel 1 de dedup (property_code+advertiser_id → property_cl) y la
 * consolidación de corredoras (advertiser_id → corredoras_cl) sobre TODO lo
 * que haya en listings_cl — tanto el histórico ya scrapeado a mano antes de
 * este plan como lo que vaya entrando nuevo. Es el mismo trabajo que hará
 * recurrentemente worker-cl.mjs (Fase 2, jobs `dedup-cluster`/`broker-enrich`)
 * sobre ./lib/dedup-cl.mjs — este runner es la corrida manual/puntual inicial
 * para poner al día lo que ya existe.
 *
 * Procesa en lotes hasta agotar lo pendiente (no un solo batch): cada llamada
 * a runNivel1DedupCl/runCorredoraConsolidationCl solo toma `batch_size` grupos
 * a la vez, así que se repite hasta que groups_processed/advertisers_processed
 * llega a 0.
 *
 * Uso:
 *   node backfill-anuncios-cl.mjs
 *   DATABASE_URL=... node backfill-anuncios-cl.mjs
 */

import pg from 'pg';
import { runNivel1DedupCl, runCorredoraConsolidationCl } from './lib/dedup-cl.mjs';

const { Client } = pg;

async function drain(fn, client, label) {
  let totalCreated = 0;
  let totalLinked = 0;
  let rounds = 0;
  for (;;) {
    const result = await fn(client);
    const processed = result.groups_processed ?? result.advertisers_processed ?? 0;
    totalCreated += result.created;
    totalLinked += result.linked;
    rounds++;
    console.log(`  [${label}] lote ${rounds}: ${JSON.stringify(result)}`);
    if (processed === 0) break;
  }
  return { totalCreated, totalLinked, rounds };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('✗ Falta DATABASE_URL');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    console.log('▶ Nivel 1 (property_code + advertiser_id → property_cl)...');
    const nivel1 = await drain(runNivel1DedupCl, client, 'nivel1');
    console.log(`✅ Nivel 1: ${nivel1.totalCreated} property_cl creados, ${nivel1.totalLinked} listings enlazados (${nivel1.rounds} lotes)\n`);

    console.log('▶ Consolidación de corredoras (advertiser_id → corredoras_cl)...');
    const corredoras = await drain(runCorredoraConsolidationCl, client, 'corredoras');
    console.log(`✅ Corredoras: ${corredoras.totalCreated} corredoras_cl creadas, ${corredoras.totalLinked} listings enlazados (${corredoras.rounds} lotes)\n`);

    console.log('✅ Backfill completado.');
    console.log('   Pendiente (fuera de alcance de este script): Nivel 2 (clustering-cl.mjs,');
    console.log('   Fase 3) y media-sync (H7, Fase 2) sobre lo ya existente.');
    process.exit(0);
  } catch (error) {
    console.error(`✗ Error en backfill: ${error.message}`);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
