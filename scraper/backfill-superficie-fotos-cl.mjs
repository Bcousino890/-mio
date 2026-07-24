#!/usr/bin/env node
/**
 * Backfill puntual: re-scrapea fichas de Portal Inmobiliario ya guardadas para
 * corregir superficie (tomaba el TERRENO en vez de la construida) y el conteo de
 * fotos (misma imagen contada con dos plantillas de URL). Reutiliza el camino del
 * worker (parser corregido + upsert) y refresca los agregados del property_cl.
 *
 * La lógica vive en lib/maintenance-cl.mjs (compartida con la corrección
 * automática de arranque del worker). Este runner es la corrida manual/puntual.
 *
 * Uso:
 *   node backfill-superficie-fotos-cl.mjs                 # casa/depto con sqm ≥ 2000
 *   node backfill-superficie-fotos-cl.mjs --min-sqm=1500  # baja el umbral
 *   node backfill-superficie-fotos-cl.mjs --dry-run       # solo lista candidatos
 *   node backfill-superficie-fotos-cl.mjs --all           # TODOS los activos (arregla fotos en todos)
 *   node backfill-superficie-fotos-cl.mjs --limit=50 --sleep=2000
 */

import pg from 'pg'
import { backfillSuperficieFotosCl } from './lib/maintenance-cl.mjs'

function parseArgs(argv) {
  const args = { minSqm: 2000, limit: null, sleepMs: 1500, dryRun: false, all: false }
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--all') args.all = true
    else if (a.startsWith('--min-sqm=')) args.minSqm = Number(a.split('=')[1])
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
      const where = args.all
        ? `portal = 'portalinmobiliario' AND is_active AND source_url IS NOT NULL`
        : `portal = 'portalinmobiliario' AND is_active AND source_url IS NOT NULL
           AND square_meters IS NOT NULL AND square_meters >= ${Number(args.minSqm)}
           AND (property_type IN ('casa','departamento') OR property_type IS NULL)`
      const { rows } = await client.query(
        `SELECT external_id, square_meters, property_type, source_url FROM listings_cl
         WHERE ${where} ORDER BY square_meters DESC NULLS LAST ${args.limit ? `LIMIT ${Number(args.limit)}` : ''}`
      )
      for (const c of rows) console.log(`  [dry-run] ${c.external_id}  sqm=${c.square_meters}  tipo=${c.property_type ?? '—'}  ${c.source_url}`)
      console.log(`\n✅ dry-run: ${rows.length} candidato(s). Sin cambios.`)
      return
    }
    await backfillSuperficieFotosCl(client, {
      minSqm: args.minSqm, all: args.all, limit: args.limit, sleepMs: args.sleepMs, log: console.log,
    })
  } finally {
    await client.end()
  }
}

main().catch((err) => { console.error('✗ error fatal:', err); process.exit(1) })
