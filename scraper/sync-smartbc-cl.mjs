#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// sync-smartbc-cl.mjs — sube al CRM SmartBC las captaciones ya trabajadas.
//
// Sustituye el alta manual que hoy solo deja la marca property_cl.smart_crm_at
// ("ya la agregué a Smart", migración 0082): las captaciones con rol SII
// confirmado, dueño y teléfono suben solas y se mantienen actualizadas solas.
//
// Uso:
//   SMARTBC_API_KEY=sbc_live_… node scraper/sync-smartbc-cl.mjs --dry-run
//   SMARTBC_API_KEY=sbc_live_… node scraper/sync-smartbc-cl.mjs --limit 100
//
// Opciones:
//   --dry-run          valida contra SmartBC y muestra qué pasaría, SIN escribir
//   --limit N          máximo de captaciones por corrida (por defecto 100)
//   --stage KEY        etapa inicial al crear (por defecto 'assigned' = "Para
//                      llamar"); --stage '' para no opinar y dejar su default
//   --no-notes         no enviar la línea de procedencia en `notes`
//   --ping             solo comprueba credenciales y sale
//
// SIEMPRE se empieza en --dry-run: hasta que ninguna respuesta traiga
// `warnings`, no se escribe en el CRM de producción del equipo.
//
// La clave va en la variable de entorno SMARTBC_API_KEY. Nunca en el repo.
// ─────────────────────────────────────────────────────────────────────────────

import { clientFromEnv } from '../web/lib/smartbc/client.mjs'
import { syncOnce } from '../web/lib/smartbc/sync.mjs'

function parseArgs(argv) {
  const args = { dryRun: false, limit: 100, stage: 'assigned', includeNotes: true, ping: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--limit') args.limit = Number(argv[++i])
    else if (a === '--stage') args.stage = argv[++i] || null
    else if (a === '--no-notes') args.includeNotes = false
    else if (a === '--ping') args.ping = true
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.error('Uso: node scraper/sync-smartbc-cl.mjs [--dry-run] [--limit N] [--stage KEY] [--no-notes] [--ping]')
    process.exit(0)
  }
  if (!process.env.SMARTBC_API_KEY) {
    console.error('✗ Falta SMARTBC_API_KEY en el entorno.')
    process.exit(1)
  }

  const smartbc = clientFromEnv({ dryRun: args.dryRun })

  // Paso 1 del arranque: si el ping no da 200, no tiene sentido seguir — el
  // fallo es de credenciales, no del payload, y cualquier otro error posterior
  // sería ruido encima de ese.
  let ping
  try {
    ping = await smartbc.ping()
  } catch (err) {
    console.error(`✗ ping falló (${err.code ?? 'error'}): ${err.message}`)
    if (err.requestId) console.error(`  request_id: ${err.requestId}`)
    process.exit(1)
  }
  console.error(`✓ ping OK — ${ping.data.client.name} (${ping.data.client.slug}, ${ping.data.client.country})`)
  console.error(`  scopes: ${ping.data.scopes.join(', ')} · ${ping.data.rate_limit_per_minute} req/min`)
  if (args.ping) return

  if (!process.env.DATABASE_URL) {
    console.error('✗ Falta DATABASE_URL en el entorno.')
    process.exit(1)
  }
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  try {
    if (args.dryRun) console.error('▶ DRY-RUN: se valida contra SmartBC pero no se escribe nada')
    const summary = await syncOnce({ client, smartbc }, {
      limit: args.limit,
      dryRun: args.dryRun,
      stage: args.stage,
      includeNotes: args.includeNotes,
      log: (msg) => console.error(`  ${msg}`),
      // Dominio público propio, para las fotos de contacto (contacts[].photo_url).
      baseUrl: process.env.APP_BASE_URL ?? null,
    })

    console.error(
      `\n✅ ${summary.total} captaciones revisadas — ` +
      `${summary.created} creadas · ${summary.updated} actualizadas · ` +
      `${summary.unchanged} sin cambios · ${summary.failed} fallidas`,
    )
    if (summary.requestIds.length) {
      console.error(`   request_ids: ${summary.requestIds.join(', ')}`)
    }
    if (summary.failed > 0) process.exitCode = 1
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(`✗ ${err.message}`)
  process.exit(1)
})
