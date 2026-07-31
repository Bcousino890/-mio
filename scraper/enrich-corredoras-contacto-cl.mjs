#!/usr/bin/env node
/**
 * Llena la ficha de empresa de las corredoras (teléfono, WhatsApp, email,
 * dirección, redes y equipo) desde su web propia. Plan Anuncios CL · H4/H21.
 *
 * La lógica vive en lib/enrich-corredora-contacto-cl.mjs; esto es la corrida
 * manual. Solo enriquece corredoras con `web_propia_url` registrada: el
 * teléfono NO se puede sacar del portal (ver docs/CONTACTO-CORREDORAS-CL.md).
 *
 * Uso:
 *   node enrich-corredoras-contacto-cl.mjs                 # 25 más grandes pendientes
 *   node enrich-corredoras-contacto-cl.mjs --limit 100
 *   node enrich-corredoras-contacto-cl.mjs --id <uuid>     # una corredora concreta
 *   node enrich-corredoras-contacto-cl.mjs --max-age 7     # refrescar fichas de +7 días
 *   node enrich-corredoras-contacto-cl.mjs --dry-run       # solo listar a quién tocaría
 */

import pg from 'pg'
import {
  selectCorredorasPendientes,
  enrichCorredoraContacto,
} from './lib/enrich-corredora-contacto-cl.mjs'

function arg(argv, name, fallback = null) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const limit = Number(arg(argv, '--limit', '25'))
  const maxAgeDays = Number(arg(argv, '--max-age', '30'))
  const corredoraId = arg(argv, '--id')

  if (!Number.isFinite(limit) || limit <= 0) { console.error('✗ --limit inválido'); process.exit(1) }
  if (!process.env.DATABASE_URL) { console.error('✗ Falta DATABASE_URL'); process.exit(1) }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const pendientes = await selectCorredorasPendientes(client, { limit, maxAgeDays, corredoraId })
    if (pendientes.length === 0) {
      console.log('✔ Nada pendiente: todas las corredoras con web propia tienen ficha de contacto al día.')
      return
    }
    console.log(`▶ ${pendientes.length} corredora(s) a enriquecer\n`)

    if (dryRun) {
      for (const c of pendientes) {
        console.log(`  · ${c.name_normalized ?? c.name_raw ?? c.id} → ${c.web_propia_url}`)
      }
      console.log('\n✅ dry-run: sin cambios.')
      return
    }

    const totals = { ok: 0, empty: 0, error: 0, no_web: 0, personas: 0 }
    for (const c of pendientes) {
      const nombre = c.name_normalized ?? c.name_raw ?? c.id
      const r = await enrichCorredoraContacto(client, c)
      totals[r.status] = (totals[r.status] ?? 0) + 1
      totals.personas += r.people ?? 0
      const detalle = r.ok
        ? `${r.phones} tel · ${r.emails} email · ${r.people} persona(s) · ${r.pages} pág.`
        : (r.error ?? r.status)
      console.log(`  ${r.ok ? '✓' : '✗'} ${nombre}: ${detalle}`)
    }

    console.log(
      `\n✅ ${totals.ok} con datos · ${totals.empty} sin datos publicados · ` +
      `${totals.error} con error · ${totals.no_web} sin web · ${totals.personas} persona(s)`
    )
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error('✗', e); process.exit(1) })
