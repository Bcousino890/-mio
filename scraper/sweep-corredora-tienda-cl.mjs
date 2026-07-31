#!/usr/bin/env node
/**
 * Barre el inventario COMPLETO (RM entera, sin depender de qué comunas estén
 * activadas en scrape_targets_cl) de las corredoras con tienda oficial
 * conocida. Plan Anuncios CL · H23.
 *
 * Por qué existe: el barrido por comuna solo ve lo que scrape_targets_cl tiene
 * activado (hoy, Las Condes). Una corredora grande publica en toda la RM —
 * verificado en vivo, Property Partners declara 1.966 casas en su tienda
 * oficial. `portal_store_slug` se descubre solo durante el scraping normal de
 * fichas (ver migración 0084); este runner es el que aprovecha ese dato.
 *
 * La lógica vive en lib/discovery-corredora-tienda-cl.mjs; esto es la corrida
 * manual/cron. Sin `--id`, toma las corredoras con tienda conocida cuyo último
 * barrido venció (24h por defecto), priorizando las de más stock.
 *
 * Uso:
 *   node sweep-corredora-tienda-cl.mjs                # 20 más urgentes
 *   node sweep-corredora-tienda-cl.mjs --limit 100
 *   node sweep-corredora-tienda-cl.mjs --id <uuid>     # una corredora concreta
 *   node sweep-corredora-tienda-cl.mjs --max-age 6      # refrescar cada 6h
 *   node sweep-corredora-tienda-cl.mjs --dry-run        # solo listar a quién tocaría
 */

import pg from 'pg'
import PgBoss from 'pg-boss'
import {
  sweepCorredoraTienda,
  selectDueCorredoraSweeps,
} from './lib/discovery-corredora-tienda-cl.mjs'

function arg(argv, name, fallback = null) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const limit = Number(arg(argv, '--limit', '20'))
  const maxAgeHours = Number(arg(argv, '--max-age', '24'))
  const corredoraId = arg(argv, '--id')

  if (!Number.isFinite(limit) || limit <= 0) { console.error('✗ --limit inválido'); process.exit(1) }
  if (!process.env.DATABASE_URL) { console.error('✗ Falta DATABASE_URL'); process.exit(1) }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  // enqueueDetail encola en la misma cola que el barrido por comuna (H2), para
  // que el worker existente baje las fichas — este runner solo descubre.
  const boss = new PgBoss(process.env.DATABASE_URL)
  await boss.start()

  try {
    let targets
    if (corredoraId) {
      const { rows } = await client.query(
        `SELECT id, portal_store_slug FROM corredoras_cl WHERE id = $1 AND portal_store_slug IS NOT NULL`,
        [corredoraId]
      )
      targets = rows
    } else {
      targets = await selectDueCorredoraSweeps(client, { limit, maxAgeHours })
    }

    if (targets.length === 0) {
      console.log('✔ Nada pendiente: ninguna corredora con tienda oficial vencida.')
      return
    }
    console.log(`▶ ${targets.length} corredora(s) a barrer por tienda\n`)

    if (dryRun) {
      for (const t of targets) console.log(`  · ${t.id} → /tienda/${t.portal_store_slug}`)
      console.log('\n✅ dry-run: sin cambios.')
      return
    }

    const enqueueDetail = async (externalId, sourceUrl) => {
      // Misma cola y forma de payload que discovery-portalinmobiliario-cl.mjs
      // (worker-cl.mjs QUEUES.DETAIL): el worker existente baja la ficha, sin
      // tocar su código.
      await boss.send('detail-cl', { externalId, sourceUrl }, { singletonKey: String(externalId), priority: 100 })
    }

    let totalSeen = 0, totalEnqueued = 0, totalDelisted = 0
    for (const t of targets) {
      const r = await sweepCorredoraTienda(client, t, { enqueueDetail })
      totalSeen += r.seen; totalEnqueued += r.enqueued; totalDelisted += r.delisted
      console.log(
        `  ${r.completed ? '✓' : '△'} /tienda/${r.store_slug}: ${r.seen} vistos` +
        (r.portal_total != null ? `/${r.portal_total} declarados` : '') +
        ` · ${r.enqueued} encolados · ${r.delisted} dados de baja` +
        (r.bands > 1 ? ` · ${r.bands} bandas` : '') +
        (r.reason ? ` · ${r.reason}` : '')
      )
    }

    console.log(`\n✅ ${totalSeen} vistos · ${totalEnqueued} fichas nuevas encoladas · ${totalDelisted} dados de baja`)
  } finally {
    await boss.stop()
    await client.end()
  }
}

main().catch((e) => { console.error('✗', e); process.exit(1) })
