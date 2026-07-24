#!/usr/bin/env node
/**
 * Reconstrucción de property_cl (deduplicación) tras corregir el falso positivo
 * del scorer (score-pair-cl.mjs): el Nivel 2 fusionaba inmuebles DISTINTOS de la
 * MISMA corredora en un solo property_cl. Re-puntúa los pares con el scorer
 * corregido, rehace Nivel 1 + Nivel 2 e individualiza los anuncios sueltos.
 *
 * La lógica vive en lib/maintenance-cl.mjs (compartida con la corrección
 * automática de arranque del worker). Este runner es la corrida manual/puntual.
 *
 * Uso:
 *   node rebuild-property-cl-cl.mjs --dry-run   # diagnóstico, sin cambios
 *   node rebuild-property-cl-cl.mjs             # re-feed + reconstrucción
 *   node rebuild-property-cl-cl.mjs --skip-feed # asume que el feeder ya re-puntuó
 */

import pg from 'pg'
import { rebuildPropertyClCl, diagnosePropertyCl } from './lib/maintenance-cl.mjs'

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const skipFeed = argv.includes('--skip-feed')
  const unknown = argv.find((a) => !['--dry-run', '--skip-feed'].includes(a))
  if (unknown) { console.error(`✗ Argumento desconocido: ${unknown}`); process.exit(1) }

  if (!process.env.DATABASE_URL) { console.error('✗ Falta DATABASE_URL'); process.exit(1) }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    if (dryRun) {
      const d = await diagnosePropertyCl(client)
      const { rows } = await client.query(
        `SELECT p.id, count(*)::int AS n_listings,
                count(DISTINCT l.property_code) FILTER (WHERE l.property_code IS NOT NULL) AS n_codes,
                count(DISTINCT l.advertiser_id) AS n_corredoras
         FROM property_cl p JOIN listings_cl l ON l.property_cl_id = p.id
         GROUP BY p.id
         HAVING count(DISTINCT l.property_code) FILTER (WHERE l.property_code IS NOT NULL) > 1
         ORDER BY n_listings DESC LIMIT 15`
      )
      console.log(`▶ ${d.total} property_cl, ${d.overMerged} sospechosos de fusión indebida:`)
      for (const r of rows) console.log(`  property_cl ${r.id}: ${r.n_listings} anuncios, ${r.n_codes} property_code, ${r.n_corredoras} corredora(s)`)
      console.log(`\n✅ dry-run: ${d.overMerged} grupo(s) se separarían. Sin cambios.`)
      return
    }
    await rebuildPropertyClCl(client, { skipFeed, log: console.log })
    console.log('✅ Reconstrucción completa.')
  } finally {
    await client.end()
  }
}

main().catch((err) => { console.error('✗ error fatal:', err); process.exit(1) })
