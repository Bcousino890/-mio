#!/usr/bin/env node
/**
 * Backfill puntual: re-scrapea fichas de Portal Inmobiliario que quedaron SIN
 * "Código de la propiedad" (property_code) para que el parser corregido —que
 * ahora también lee el código del DOM ("Información de la corredora"), no solo
 * del blob Nordic— lo rellene. Reutiliza el camino del worker (parser + upsert)
 * y refresca los agregados del property_cl afectado.
 *
 * La lógica vive en lib/maintenance-cl.mjs (backfillPropertyCodeCl). Este runner
 * es la corrida manual/puntual — hace fetch real a portalinmobiliario.com, así
 * que está rate-limited (sleepMs) y es idempotente (el set de candidatos con
 * property_code IS NULL se encoge solo a medida que se rellenan).
 *
 * Uso:
 *   node backfill-property-code-cl.mjs                  # todas las activas sin código
 *   node backfill-property-code-cl.mjs --dry-run        # solo lista candidatos
 *   node backfill-property-code-cl.mjs --limit=100 --sleep=2500
 */

import pg from 'pg'
import { backfillPropertyCodeCl } from './lib/maintenance-cl.mjs'

function parseArgs(argv) {
  const args = { limit: null, sleepMs: 1500, dryRun: false }
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') args.dryRun = true
    else if (a.startsWith('--limit=')) args.limit = Number(a.split('=')[1])
    else if (a.startsWith('--sleep=')) args.sleepMs = Number(a.split('=')[1])
    else { console.error(`✗ Argumento desconocido: ${a}`); process.exit(1) }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv)
  if (!process.env.DATABASE_URL) { console.error('✗ Falta DATABASE_URL'); process.exit(1) }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    if (args.dryRun) {
      const { rows } = await client.query(
        `SELECT external_id, source_url FROM listings_cl
         WHERE portal = 'portalinmobiliario' AND is_active
           AND source_url IS NOT NULL AND property_code IS NULL
         ORDER BY last_seen_at DESC NULLS LAST ${args.limit ? `LIMIT ${Number(args.limit)}` : ''}`
      )
      for (const c of rows) console.log(`  [dry-run] ${c.external_id}  ${c.source_url}`)
      console.log(`\n✅ dry-run: ${rows.length} candidato(s) sin property_code. Sin cambios.`)
      return
    }
    await backfillPropertyCodeCl(client, {
      limit: args.limit, sleepMs: args.sleepMs, log: console.log,
    })
  } finally {
    await client.end()
  }
}

main().catch((err) => { console.error('✗ error fatal:', err); process.exit(1) })
