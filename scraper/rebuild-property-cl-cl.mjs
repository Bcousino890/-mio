#!/usr/bin/env node
/**
 * Reconstrucción de property_cl (deduplicación) tras corregir el falso positivo
 * del scorer (score-pair-cl.mjs): el Nivel 2 fusionaba inmuebles DISTINTOS de la
 * MISMA corredora (misma comuna, m², dormitorios y pin genérico) en un solo
 * property_cl, aunque no compartieran foto/teléfono/dirección. Ahora el scorer
 * exige evidencia dura de misma propiedad para auto-confirmar; este runner:
 *
 *   1. Re-puntúa listing_match_cl con el scorer corregido (baja los pares
 *      "solo misma corredora" de 'confirmed' a 'candidate') — salvo --skip-feed.
 *   2. RECONSTRUYE property_cl desde cero (es una entidad DERIVADA, ver
 *      clustering-cl.mjs §"FUSIÓN vs. datos crudos"; solo listings_cl la referencia,
 *      con ON DELETE SET NULL, así que borrarla no pierde ninguna verdad cruda):
 *        a. desengancha todos los listings y borra los property_cl,
 *        b. Nivel 1 determinista (property_code + advertiser_id),
 *        c. Nivel 2 probabilístico (solo pares que siguen 'confirmed' con evidencia),
 *        d. INDIVIDUALIZA: cada anuncio activo que quede sin property_cl (sin
 *           property_code y sin match confirmado) obtiene su propia ficha — "un
 *           anuncio, una propiedad", nunca fusionado con otro que no le corresponde.
 *
 * Los pasos a–d corren en UNA transacción: el CRM ve el estado viejo hasta el
 * commit, sin ventana con la vista vacía. Idempotente: re-ejecutar da el mismo
 * resultado.
 *
 * Uso:
 *   node rebuild-property-cl-cl.mjs --dry-run   # diagnóstico, sin cambios
 *   node rebuild-property-cl-cl.mjs             # re-feed + reconstrucción
 *   node rebuild-property-cl-cl.mjs --skip-feed # asume el feeder ya re-puntuó
 *
 * Conviene correrlo en una ventana de baja actividad (toma un lock amplio sobre
 * listings_cl/property_cl mientras reconstruye). DATABASE_URL obligatoria.
 */

import pg from 'pg'
import {
  runNivel1DedupCl,
  runCorredoraConsolidationCl,
  createPropertyCl,
  LISTING_FIELDS_FOR_CONSOLIDATION,
} from './lib/dedup-cl.mjs'
import { runNivel2ClusteringCl } from './lib/clustering-cl.mjs'
import { runMatchFeederCl } from './lib/match-feeder-cl.mjs'

const { Client } = pg

function parseArgs(argv) {
  const args = { dryRun: false, skipFeed: false }
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--skip-feed') args.skipFeed = true
    else { console.error(`✗ Argumento desconocido: ${a}`); process.exit(1) }
  }
  return args
}

async function drain(fn, client, label) {
  let created = 0, linked = 0, rounds = 0
  for (;;) {
    const r = await fn(client)
    const processed = r.groups_processed ?? r.advertisers_processed ?? 0
    created += r.created; linked += r.linked; rounds++
    if (processed === 0) break
  }
  return { created, linked, rounds }
}

async function diagnose(client) {
  const total = await client.query(`SELECT count(*)::int AS n FROM property_cl`)
  const overMerged = await client.query(
    `SELECT count(*)::int AS n FROM (
       SELECT p.id
       FROM property_cl p
       JOIN listings_cl l ON l.property_cl_id = p.id
       GROUP BY p.id
       HAVING count(DISTINCT l.property_code) FILTER (WHERE l.property_code IS NOT NULL) > 1
     ) q`
  )
  return { total: total.rows[0].n, overMerged: overMerged.rows[0].n }
}

async function individualizeOrphans(client) {
  // Cada anuncio ACTIVO sin property_cl (sin property_code o sin match) pasa a ser
  // su propia propiedad — así ningún anuncio queda escondido ni fusionado de más.
  const { rows: orphans } = await client.query(
    `SELECT ${LISTING_FIELDS_FOR_CONSOLIDATION}
     FROM listings_cl WHERE property_cl_id IS NULL AND is_active = true`
  )
  let created = 0
  for (const row of orphans) {
    const pid = await createPropertyCl(client, [row])
    await client.query(
      `UPDATE listings_cl SET property_cl_id = $1, match_confidence = 1, updated_at = now() WHERE id = $2`,
      [pid, row.id],
    )
    created++
  }
  return created
}

async function main() {
  const args = parseArgs(process.argv)
  if (!process.env.DATABASE_URL) {
    console.error('✗ Falta DATABASE_URL')
    process.exit(1)
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  try {
    const before = await diagnose(client)
    console.log(`▶ Estado actual: ${before.total} property_cl, ${before.overMerged} sospechosos de fusión indebida (≥2 property_code distintos).`)

    if (args.dryRun) {
      const { rows } = await client.query(
        `SELECT p.id, count(*)::int AS n_listings,
                count(DISTINCT l.property_code) FILTER (WHERE l.property_code IS NOT NULL) AS n_codes,
                count(DISTINCT l.advertiser_id) AS n_corredoras
         FROM property_cl p
         JOIN listings_cl l ON l.property_cl_id = p.id
         GROUP BY p.id
         HAVING count(DISTINCT l.property_code) FILTER (WHERE l.property_code IS NOT NULL) > 1
         ORDER BY n_listings DESC LIMIT 15`
      )
      for (const r of rows) {
        console.log(`  [dry-run] property_cl ${r.id}: ${r.n_listings} anuncios, ${r.n_codes} property_code, ${r.n_corredoras} corredora(s)`)
      }
      console.log(`\n✅ dry-run: ${before.overMerged} grupo(s) se separarían. Sin cambios.`)
      return
    }

    // 1. Re-puntuar los pares (fuera de la transacción de reconstrucción).
    if (!args.skipFeed) {
      const { rows: comunas } = await client.query(
        `SELECT DISTINCT comuna_id FROM listings_cl WHERE is_active = true AND comuna_id IS NOT NULL`
      )
      const comunaIds = comunas.map((r) => r.comuna_id)
      console.log(`▶ Re-puntuando pares en ${comunaIds.length} comuna(s) con el scorer corregido...`)
      const fed = await runMatchFeederCl(client, { comunaIds })
      console.log(`  listing_match_cl: ${fed.confirmed} confirmados, ${fed.candidate} candidatos (${fed.pairs_scored} pares puntuados)`)
    } else {
      console.log('▶ --skip-feed: se asume que el feeder ya re-puntuó con el scorer corregido.')
    }

    // 2. Reconstrucción atómica de property_cl.
    console.log('▶ Reconstruyendo property_cl (en transacción)...')
    await client.query('BEGIN')
    try {
      await client.query(`UPDATE listings_cl SET property_cl_id = NULL, match_confidence = NULL WHERE property_cl_id IS NOT NULL`)
      await client.query(`DELETE FROM property_cl`)

      const n1 = await drain(runNivel1DedupCl, client, 'nivel1')
      console.log(`  Nivel 1: ${n1.created} property_cl (property_code + corredora)`)

      const n2 = await runNivel2ClusteringCl(client)
      console.log(`  Nivel 2: ${n2.merged} fusiones con evidencia dura (${n2.edges} aristas confirmadas)`)

      const indiv = await individualizeOrphans(client)
      console.log(`  Individuales: ${indiv} anuncio(s) sin código/match quedaron como propiedad propia`)

      await drain(runCorredoraConsolidationCl, client, 'corredoras')

      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    }

    const after = await diagnose(client)
    console.log(`\n✅ Listo: ${before.total} → ${after.total} property_cl. Fusiones indebidas: ${before.overMerged} → ${after.overMerged}.`)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('✗ error fatal:', err)
  process.exit(1)
})
