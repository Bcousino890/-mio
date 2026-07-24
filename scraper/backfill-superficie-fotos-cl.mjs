#!/usr/bin/env node
/**
 * Backfill puntual: re-scrapea fichas de Portal Inmobiliario ya guardadas para
 * corregir dos datos que arrastraban un bug del parser (ya corregido en
 * lib/parse-portalinmobiliario.mjs y web/lib/parse-portalinmobiliario-cl.ts):
 *
 *   1. SUPERFICIE: `square_meters` tomaba el TERRENO de la parcela (ej. 23056 m²)
 *      en vez de la superficie construida (232 m²). El re-scrape la recalcula.
 *   2. FOTOS: el conteo se inflaba (la misma imagen contada con dos plantillas
 *      de URL). El re-scrape deduplica por id de foto de ML.
 *
 * Reutiliza EXACTAMENTE el camino del worker (`handleDetailJob`: fetch resiliente
 * con fallback a proxy + parseDetailPage corregido + upsertListingCl), así que el
 * resultado es idéntico a un barrido normal. Después recalcula los agregados del
 * property_cl (dedup) para que la superficie CANÓNICA que muestra el CRM
 * (`property_cl.square_meters = mode(listings)`) refleje los valores corregidos.
 *
 * Selección por defecto: anuncios activos de Portal Inmobiliario cuya superficie
 * es claramente el terreno filtrado (casa/departamento con square_meters ≥ 2000
 * m²; una superficie CONSTRUIDA de vivienda casi nunca supera eso en Chile).
 *
 * Uso:
 *   node backfill-superficie-fotos-cl.mjs                # casa/depto con sqm ≥ 2000
 *   node backfill-superficie-fotos-cl.mjs --min-sqm=1500 # baja el umbral
 *   node backfill-superficie-fotos-cl.mjs --dry-run      # solo lista candidatos
 *   node backfill-superficie-fotos-cl.mjs --all          # TODOS los activos (arregla fotos en todos)
 *   node backfill-superficie-fotos-cl.mjs --limit=50 --sleep=2000
 *
 * Variables de entorno: DATABASE_URL (obligatoria) + las del proxy residencial
 * y la tasa UF que ya usa el worker (mismos nombres).
 */

import pg from 'pg'
import { handleDetailJob } from './worker-cl.mjs'
import { refreshPropertyClAggregates } from './lib/dedup-cl.mjs'
import { SLEEP } from './lib/fetch.mjs'

const { Client } = pg

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

// Candidatos a re-scrapear. `--all` toma todos los activos de Portal (arregla
// también el conteo de fotos en fichas cuya superficie ya era correcta); el modo
// por defecto se limita a la superficie sospechosa (terreno filtrado como sqm).
function candidatesQuery(args) {
  if (args.all) {
    return {
      text: `SELECT id, external_id, source_url, property_cl_id, square_meters, property_type
             FROM listings_cl
             WHERE portal = 'portalinmobiliario' AND is_active AND source_url IS NOT NULL
             ORDER BY square_meters DESC NULLS LAST
             ${args.limit ? 'LIMIT $1' : ''}`,
      values: args.limit ? [args.limit] : [],
    }
  }
  const values = [args.minSqm]
  if (args.limit) values.push(args.limit)
  return {
    text: `SELECT id, external_id, source_url, property_cl_id, square_meters, property_type
           FROM listings_cl
           WHERE portal = 'portalinmobiliario' AND is_active AND source_url IS NOT NULL
             AND square_meters IS NOT NULL AND square_meters >= $1
             AND (property_type IN ('casa','departamento') OR property_type IS NULL)
           ORDER BY square_meters DESC
           ${args.limit ? 'LIMIT $2' : ''}`,
    values,
  }
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
    const q = candidatesQuery(args)
    const { rows: candidates } = await client.query(q.text, q.values)
    console.log(`▶ ${candidates.length} anuncio(s) candidato(s) ${args.all ? '(--all: todos los activos)' : `(square_meters ≥ ${args.minSqm})`}`)

    if (args.dryRun) {
      for (const c of candidates) {
        console.log(`  [dry-run] ${c.external_id}  sqm=${c.square_meters}  tipo=${c.property_type ?? '—'}  ${c.source_url}`)
      }
      console.log(`\n✅ dry-run: ${candidates.length} candidato(s). Sin cambios.`)
      return
    }

    let ok = 0, failed = 0
    const touchedProps = new Set()

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]
      const before = c.square_meters
      try {
        const res = await handleDetailJob(client, { externalId: c.external_id, sourceUrl: c.source_url })
        if (res.ok) {
          ok++
          // Lee el valor recién guardado para dejar traza del antes/después.
          const { rows } = await client.query(`SELECT square_meters FROM listings_cl WHERE id = $1`, [c.id])
          const after = rows[0]?.square_meters ?? null
          console.log(`  [${i + 1}/${candidates.length}] ${c.external_id}: sqm ${before} → ${after}${before !== after ? ' ✔' : ''}`)
        } else {
          failed++
          console.warn(`  [${i + 1}/${candidates.length}] ${c.external_id}: re-scrape falló (${res.reason})`)
        }
      } catch (e) {
        failed++
        console.warn(`  [${i + 1}/${candidates.length}] ${c.external_id}: error ${e.message}`)
      }
      if (c.property_cl_id) touchedProps.add(c.property_cl_id)
      if (i < candidates.length - 1) await SLEEP(args.sleepMs)
    }

    // Recalcula la superficie/fotos CANÓNICAS del inmueble deduplicado a partir
    // de sus listings ya corregidos (property_cl.square_meters = mode(listings)).
    console.log(`\n▶ Recalculando agregados de ${touchedProps.size} property_cl...`)
    let refreshed = 0
    for (const pid of touchedProps) {
      try { await refreshPropertyClAggregates(client, pid); refreshed++ }
      catch (e) { console.warn(`  property_cl ${pid}: ${e.message}`) }
    }

    console.log(`\n✅ Listo: ${ok} re-scrapeados, ${failed} fallidos, ${refreshed} property_cl actualizados.`)
    if (failed > 0) console.log('   (Los fallidos suelen ser bloqueos puntuales del portal — reintentá el backfill.)')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('✗ error fatal:', err)
  process.exit(1)
})
