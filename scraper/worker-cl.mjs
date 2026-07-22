#!/usr/bin/env node
/**
 * Worker 24/7 del módulo Anuncios CL (plan Anuncios CL · H2).
 *
 * Proceso Node persistente sobre pg-boss (cola sobre el mismo Postgres, sin
 * Redis extra) — pensado para correr en un contenedor separado del CRM
 * (docker-compose, con mem_limit propio) para que un scraper colgado no
 * tumbe el resto de la app.
 *
 * Colas cableadas y funcionando de punta a punta (no dependen del spike
 * bloqueado de Fase 0):
 *   - detail-cl        → upsertListingCl() sobre una ficha ya conocida (por
 *                         MLC-id), encola media-sync-cl si trae fotos nuevas.
 *   - media-sync-cl     → syncListingMediaCl() al bucket de Hetzner.
 *   - dedup-cluster-cl  → pipeline de dedup en UNA pasada ordenada, cada 15min:
 *                         Nivel 1 determinista (runNivel1DedupCl) → Nivel 2
 *                         probabilístico (runNivel2ClusteringCl, fusiona los
 *                         property_cl de corredoras distintas) → consolidación
 *                         de corredoras (runCorredoraConsolidationCl). El orden
 *                         importa: exclusivity_ratio de la corredora depende del
 *                         corredora_count final de property_cl, que solo queda
 *                         correcto tras el Nivel 2 (ver dedup-cl.mjs).
 *   - broker-enrich-cl  → runCorredoraConsolidationCl() suelto, para re-enriquecer
 *                         corredoras on-demand (boss.send) sin correr todo el
 *                         pipeline. El refresco periódico ya lo hace dedup-cluster-cl.
 *
 * Cola registrada pero SIN handler real todavía:
 *   - discovery-cl → el patrón de URL de listado de Portal Inmobiliario NO
 *     está confirmado contra HTML real (docs/research-portalinmobiliario-chile.md
 *     lo marca explícitamente "no confirmado"). Implementarlo ahora sería
 *     adivinar y arriesgar requests mal formados contra el portal real. El
 *     handler queda como stub (loguea y no toca la red) hasta que el spike
 *     de Fase 0 (H0) confirme el patrón — entonces se completa este archivo,
 *     no se reescribe: la cola, el registro en pg-boss y el resto del worker
 *     ya están listos para recibirlo.
 *
 * Cada handler de trabajo se expone como función nombrada e inyectable
 * (mismo patrón de dependency injection que resilient-fetch.mjs/dedup-cl.mjs)
 * para poder testear la lógica sin red real ni pg-boss corriendo — ver
 * cabecera de cada función.
 */
import PgBoss from 'pg-boss'
import pg from 'pg'
import { fetchHtmlResilient } from './lib/fetch.mjs'
import { parseDetailPage } from './lib/parse-portalinmobiliario.mjs'
import { upsertListingCl } from './lib/upsert-listing-cl.mjs'
import { syncListingMediaCl } from './lib/media-sync-cl.mjs'
import { createHetznerS3Client } from './lib/hetzner-s3.mjs'
import { runNivel1DedupCl, runCorredoraConsolidationCl } from './lib/dedup-cl.mjs'
import { runNivel2ClusteringCl } from './lib/clustering-cl.mjs'

export const QUEUES = {
  DETAIL: 'detail-cl',
  MEDIA_SYNC: 'media-sync-cl',
  DEDUP_CLUSTER: 'dedup-cluster-cl',
  BROKER_ENRICH: 'broker-enrich-cl',
  DISCOVERY: 'discovery-cl',
}

/**
 * Job `detail-cl`: fetch + parse + upsert de una ficha por MLC-id.
 * `deps` inyectables para test: { fetch: fetchHtmlResilient, parse: parseDetailPage, upsert: upsertListingCl, enqueueMediaSync }
 */
export async function handleDetailJob(dbClient, jobData, deps = {}) {
  const {
    fetch: fetchImpl = fetchHtmlResilient,
    parse = parseDetailPage,
    upsert = upsertListingCl,
    enqueueMediaSync = async () => {},
  } = deps

  const { externalId, sourceUrl } = jobData
  const url = sourceUrl ?? `https://www.portalinmobiliario.com/${externalId}`
  const res = await fetchImpl(url, { profile: 'portalinmobiliario' })
  if (!res.ok) {
    console.error(`[detail] ${externalId}: fetch falló (${res.reason})`)
    return { ok: false, reason: res.reason }
  }

  const parsed = await parse(res.html, externalId)
  if (!parsed) {
    console.error(`[detail] ${externalId}: parseDetailPage no pudo extraer nada`)
    return { ok: false, reason: 'parse_failed' }
  }

  const { listingId, changeType } = await upsert(dbClient, parsed)
  console.log(`[detail] ${externalId} → listing ${listingId} (${changeType ?? 'sin cambios'})`)

  if (Array.isArray(parsed.photos) && parsed.photos.length > 0) {
    await enqueueMediaSync(listingId)
  }
  return { ok: true, listingId, changeType }
}

/**
 * Job `media-sync-cl`: sincroniza las fotos de un listing al bucket.
 * `deps.s3` inyectable para test (ver hetzner-s3.mjs).
 */
export async function handleMediaSyncJob(dbClient, jobData, deps = {}) {
  const { s3, sync = syncListingMediaCl } = deps
  if (!s3) return { ok: false, reason: 'sin cliente S3 configurado' }

  const { listingId } = jobData
  const { rows } = await dbClient.query(`SELECT photos FROM listings_cl WHERE id = $1`, [listingId])
  const photoUrls = rows[0]?.photos ?? []
  if (photoUrls.length === 0) return { ok: true, skipped: true }

  const res = await sync(dbClient, s3, listingId, photoUrls)
  console.log(`[media-sync] ${listingId}: ${res.uploaded} nuevas, ${res.reused} reutilizadas, ${res.failed} fallidas`)
  return { ok: true, ...res }
}

/**
 * Job `dedup-cluster-cl` (periódico): pipeline de dedup en una pasada ordenada
 * Nivel 1 → Nivel 2 → consolidación de corredoras. El orden NO es opcional: la
 * exclusividad de cada corredora depende del corredora_count final de property_cl,
 * que solo queda correcto tras fusionar los grupos en el Nivel 2 (ver dedup-cl.mjs).
 * `deps` inyectables para test.
 */
export async function handleDedupClusterJob(dbClient, deps = {}) {
  const {
    nivel1 = runNivel1DedupCl,
    nivel2 = runNivel2ClusteringCl,
    broker = runCorredoraConsolidationCl,
  } = deps
  const res = {
    nivel1: await nivel1(dbClient),
    nivel2: await nivel2(dbClient),
    broker: await broker(dbClient),
  }
  console.log(`[dedup-cluster] ${JSON.stringify(res)}`)
  return res
}

/** Job `broker-enrich-cl` (on-demand): re-consolida corredoras sin correr el pipeline entero. */
export async function handleBrokerEnrichJob(dbClient, deps = {}) {
  const { run = runCorredoraConsolidationCl } = deps
  const res = await run(dbClient)
  console.log(`[broker-enrich] ${JSON.stringify(res)}`)
  return res
}

/** Job `discovery-cl`: stub, ver cabecera del archivo. Nunca toca la red. */
export async function handleDiscoveryJob(jobData) {
  console.warn(`[discovery] PENDIENTE (Fase 0/H1): ${JSON.stringify(jobData)} — ver docs/PLAN-ANUNCIOS-CL.md`)
  return { ok: false, reason: 'pending_fase_0' }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('✗ Falta DATABASE_URL')
    process.exit(1)
  }

  const { Client } = pg
  const dbClient = new Client({ connectionString: databaseUrl })
  await dbClient.connect()

  const boss = new PgBoss(databaseUrl)
  boss.on('error', (err) => console.error('[worker-cl] pg-boss error:', err))
  await boss.start()

  for (const queueName of Object.values(QUEUES)) {
    await boss.createQueue(queueName)
  }

  let s3 = null
  try {
    s3 = createHetznerS3Client()
  } catch (e) {
    console.warn(`[worker-cl] media-sync-cl deshabilitado: ${e.message}`)
  }

  await boss.work(QUEUES.DETAIL, async (jobs) => {
    for (const job of jobs) {
      await handleDetailJob(dbClient, job.data, {
        enqueueMediaSync: (listingId) => boss.send(QUEUES.MEDIA_SYNC, { listingId }),
      })
    }
  })

  if (s3) {
    await boss.work(QUEUES.MEDIA_SYNC, async (jobs) => {
      for (const job of jobs) await handleMediaSyncJob(dbClient, job.data, { s3 })
    })
  }

  // Pipeline de dedup completo (Nivel 1 → Nivel 2 → corredoras) cada 15min.
  await boss.work(QUEUES.DEDUP_CLUSTER, async () => { await handleDedupClusterJob(dbClient) })
  await boss.schedule(QUEUES.DEDUP_CLUSTER, '*/15 * * * *')

  // broker-enrich queda como cola on-demand (boss.send), sin schedule propio: el
  // refresco periódico de corredoras ya lo hace el pipeline de dedup-cluster.
  await boss.work(QUEUES.BROKER_ENRICH, async () => { await handleBrokerEnrichJob(dbClient) })

  await boss.work(QUEUES.DISCOVERY, async (jobs) => {
    for (const job of jobs) await handleDiscoveryJob(job.data)
  })

  console.log(`[worker-cl] arrancado. Colas: ${Object.values(QUEUES).join(', ')}`)

  const shutdown = async () => {
    console.log('[worker-cl] apagando...')
    await boss.stop()
    await dbClient.end()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

// Solo arranca el proceso persistente si se ejecuta directamente (no al
// importar las funciones de handler para tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[worker-cl] error fatal:', err)
    process.exit(1)
  })
}
