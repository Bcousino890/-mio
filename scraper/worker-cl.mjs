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
 *   - discovery-scheduler-cl → periódico (cada 15min): lee scrape_targets_cl y
 *                         encola un discovery-cl por cada comuna `enabled` cuya
 *                         cadencia (interval_hours) venció. Config-driven: no hay
 *                         comunas hardcodeadas (H8).
 *   - discovery-cl      → barre una comuna (discoverTarget, H1): pagina el listado
 *                         de usadas, encola detail-cl de los anuncios nuevos y
 *                         marca las bajas. El patrón de URL/paginación quedó
 *                         confirmado en Fase 0 contra HTML real (ver
 *                         docs/research-portalinmobiliario-chile.md).
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
import { runNivel1DedupCl, runCorredoraConsolidationCl, reconcilePropertyClDerivedCl } from './lib/dedup-cl.mjs'
import { pruneDuplicateJobsCl } from './lib/queue-maintenance-cl.mjs'
import { runInternalCodeLinkCl } from './lib/link-internal-code-cl.mjs'
import { runNivel2ClusteringCl } from './lib/clustering-cl.mjs'
import { runStartupFixesCl, DEDUP_ADVISORY_LOCK_KEY } from './lib/maintenance-cl.mjs'
import { discoverTarget, selectDueTargets } from './lib/discovery-portalinmobiliario-cl.mjs'
import { runMatchFeederCl } from './lib/match-feeder-cl.mjs'
import { crawlCorredoraWebTarget, selectDueWebTargets } from './lib/crawl-corredora-web-cl.mjs'
import { getUfRateCl } from './lib/uf-rate-cl.mjs'

export const QUEUES = {
  DETAIL: 'detail-cl',
  MEDIA_SYNC: 'media-sync-cl',
  MATCH_FEEDER: 'match-feeder-cl',
  DEDUP_CLUSTER: 'dedup-cluster-cl',
  BROKER_ENRICH: 'broker-enrich-cl',
  DISCOVERY: 'discovery-cl',
  DISCOVERY_SCHEDULER: 'discovery-scheduler-cl',
  CORREDORA_WEB: 'corredora-web-crawl-cl',
  CORREDORA_WEB_SCHEDULER: 'corredora-web-scheduler-cl',
}

/**
 * Job `detail-cl`: fetch + parse + upsert de una ficha por MLC-id.
 * `deps` inyectables para test: { fetch: fetchHtmlResilient, parse: parseDetailPage, upsert: upsertListingCl, enqueueMediaSync, getUfRate: getUfRateCl }
 */
export async function handleDetailJob(dbClient, jobData, deps = {}) {
  const {
    fetch: fetchImpl = fetchHtmlResilient,
    parse = parseDetailPage,
    upsert = upsertListingCl,
    enqueueMediaSync = async () => {},
    getUfRate = getUfRateCl,
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

  // El permalink CON slug del listado (sourceUrl del discovery) es el que
  // redirige a la ficha real; la forma corta MLC-<id> del blob de detalle
  // redirige al home. Preferimos el del discovery para el "Ver aviso" de la UI.
  if (sourceUrl && /portalinmobiliario\.com\/MLC-?\d+-/.test(sourceUrl)) {
    parsed.source_url = sourceUrl
  }

  // BUG CRÍTICO cerrado aquí: este handler nunca pasaba ufRate a upsertListingCl,
  // así que resolvePriceClp() (to-listing.mjs) devolvía null para CUALQUIER
  // anuncio con currency='UF' sin price_clp propio — la inmensa mayoría de los
  // anuncios chilenos, que se publican en UF. El precio en CLP quedaba NULL en
  // toda la base (visible en la ficha como "—"), aunque price_uf sí se guardaba.
  // getUfRateCl() cachea en memoria por día y dedupe peticiones en vuelo — llamarla
  // una vez por ficha no dispara un fetch nuevo por anuncio.
  const uf = await getUfRate()
  const upsertOptions = uf.ok ? { ufRate: uf.rate, ufRateDate: uf.date } : {}
  if (!uf.ok) console.warn(`[detail] ${externalId}: sin tasa UF (${uf.reason}) — price CLP quedará null si el anuncio está en UF`)

  const { listingId, changeType } = await upsert(dbClient, parsed, upsertOptions)
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
 * Nivel 1 → Nivel 2 → enlace por código interno (Nivel 1.5) → consolidación de
 * corredoras. El orden NO es opcional: la exclusividad de cada corredora depende
 * del corredora_count final de property_cl, que solo queda correcto tras fusionar
 * los grupos en el Nivel 2 y sumar las fichas de webs propias (Nivel 1.5) al
 * inmueble canónico (ver dedup-cl.mjs y link-internal-code-cl.mjs).
 * `deps` inyectables para test.
 */
export async function handleDedupClusterJob(dbClient, deps = {}) {
  const {
    nivel1 = runNivel1DedupCl,
    // Clustering probabilístico DESACTIVADO por decisión del usuario: la única
    // regla de deduplicación válida es corredora (advertiser_id) + código interno
    // (seller_reference). Corredoras distintas nunca comparten código interno, así
    // que el matching difuso (geo/m²/pHash) solo podía producir fusiones falsas —
    // fichas de propiedades distintas mostradas como una sola. Se pasa explícito
    // (fuzzyClustering: runNivel2ClusteringCl) para reactivarlo si algún día se
    // decide lo contrario; el código de clustering-cl.mjs queda intacto.
    nivel2 = null,
    link15 = runInternalCodeLinkCl,
    broker = runCorredoraConsolidationCl,
    reconcile = reconcilePropertyClDerivedCl,
    pruneJobs = pruneDuplicateJobsCl,
  } = deps
  const res = {
    nivel1: await nivel1(dbClient),
    nivel2: nivel2 ? await nivel2(dbClient) : { skipped: 'dedup solo por corredora + código interno' },
    // Nivel 1.5 (H21): engancha las fichas de webs propias (agency_web) al
    // property_cl del anuncio de PI de la misma corredora por código interno.
    link15: await link15(dbClient),
    broker: await broker(dbClient),
    // Re-sincroniza is_active/listing_count/corredora_count de property_cl con
    // sus anuncios. Va AL FINAL, cuando el resto del pipeline ya movió anuncios
    // entre fichas. Sin esto, dar de baja o reactivar un anuncio (que ocurre
    // fuera del dedup) deja la ficha desincronizada y /chile/propiedades —que
    // filtra por is_active— esconde propiedades vivas.
    reconcile: await reconcile(dbClient),
    // Red de seguridad del atasco de colas: deja un pendiente por anuncio. La
    // prevención real es el singletonKey del `send`; esto cura lo ya apilado y
    // cubre cualquier camino que encole sin clave.
    prune: await pruneJobs(dbClient),
  }
  console.log(`[dedup-cluster] ${JSON.stringify(res)}`)
  return res
}

/**
 * Job `match-feeder-cl` (periódico): puebla listing_match_cl puntuando los pares
 * candidatos (blocking + scorer de par). Corre en su propia cadencia (más
 * espaciada, es O(n²) por comuna); el clustering Nivel 2 consume sus confirmados
 * en la siguiente pasada del pipeline de dedup.
 */
export async function handleMatchFeederJob(dbClient, deps = {}) {
  const { run = runMatchFeederCl } = deps
  const res = await run(dbClient)
  console.log(`[match-feeder] ${JSON.stringify(res)}`)
  return res
}

/** Job `broker-enrich-cl` (on-demand): re-consolida corredoras sin correr el pipeline entero. */
export async function handleBrokerEnrichJob(dbClient, deps = {}) {
  const { run = runCorredoraConsolidationCl } = deps
  const res = await run(dbClient)
  console.log(`[broker-enrich] ${JSON.stringify(res)}`)
  return res
}

/**
 * Job `discovery-cl` (H1): barre una comuna y encola detail-cl de lo nuevo.
 * `deps.enqueueDetail` inyectable; en producción encola en la cola detail-cl.
 */
export async function handleDiscoveryJob(dbClient, jobData, deps = {}) {
  const { discover = discoverTarget, enqueueDetail } = deps
  const target = jobData?.target
  if (!target?.id) {
    console.error('[discovery] job sin target válido:', JSON.stringify(jobData))
    return { ok: false, reason: 'sin target' }
  }
  const res = await discover(dbClient, target, { enqueueDetail })
  console.log(`[discovery] ${target.comuna_name} ${target.operation}: ${JSON.stringify(res)}`)
  return { ok: true, ...res }
}

/**
 * Job `discovery-scheduler-cl` (periódico): encola un discovery-cl por cada
 * comuna `enabled` cuya cadencia venció. `deps` inyectables para test.
 */
export async function handleDiscoverySchedulerJob(dbClient, deps = {}) {
  const { select = selectDueTargets, enqueueDiscovery = async () => {} } = deps
  const targets = await select(dbClient)
  for (const target of targets) await enqueueDiscovery(target)
  console.log(`[discovery-scheduler] ${targets.length} comunas encoladas`)
  return { enqueued: targets.length }
}

/**
 * Job `corredora-web-crawl-cl` (H21): crawl de la web propia de UNA corredora →
 * inserta sus fichas como listings_cl (agency_web). El Nivel 1.5 del pipeline de
 * dedup las une luego al anuncio de PI por código interno. `deps` inyectables.
 */
export async function handleCorredoraWebCrawlJob(dbClient, jobData, deps = {}) {
  const { crawl = crawlCorredoraWebTarget } = deps
  const target = jobData?.target
  if (!target?.id) {
    console.error('[corredora-web] job sin target válido:', JSON.stringify(jobData))
    return { ok: false, reason: 'sin target' }
  }
  const res = await crawl(dbClient, target, {
    enqueueMediaSync: deps.enqueueMediaSync,
  })
  console.log(`[corredora-web] ${target.domain} (${target.crm_platform}): ${JSON.stringify(res)}`)
  return res
}

/**
 * Job `corredora-web-scheduler-cl` (periódico): encola un crawl por cada web
 * `enabled` cuya cadencia (24h por defecto) venció. Config-driven — activar una
 * web es un UPDATE en corredora_web_targets_cl, sin tocar código.
 */
export async function handleCorredoraWebSchedulerJob(dbClient, deps = {}) {
  const { select = selectDueWebTargets, enqueueCrawl = async () => {} } = deps
  const targets = await select(dbClient)
  for (const target of targets) await enqueueCrawl(target)
  console.log(`[corredora-web-scheduler] ${targets.length} webs encoladas`)
  return { enqueued: targets.length }
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

  // Colas DEDUPLICADAS: `policy: 'short'` + `singletonKey` = como mucho UN job
  // PENDIENTE por entidad. Con la política 'standard' de por defecto, pg-boss
  // crea un job nuevo en cada `send` aunque se repita el singletonKey, así que
  // cada barrido re-encolaba los mismos anuncios: detail-cl acumuló 46.797
  // pendientes para ~3.700 anuncios reales y un anuncio nuevo quedaba enterrado
  // días detrás de sus propios duplicados — la razón de que el contador de
  // anuncios crudos no subiera. Verificado: con 'short', 5 envíos = 1 job.
  const DEDUPED_QUEUES = new Set([QUEUES.DETAIL, QUEUES.MEDIA_SYNC])
  for (const queueName of Object.values(QUEUES)) {
    const policy = DEDUPED_QUEUES.has(queueName) ? 'short' : 'standard'
    await boss.createQueue(queueName, { name: queueName, policy })
    // createQueue NO cambia la política de una cola ya existente, y las de
    // producción nacieron 'standard': hay que migrarlas explícitamente.
    if (DEDUPED_QUEUES.has(queueName)) {
      await boss.updateQueue(queueName, { name: queueName, policy })
    }
  }

  let s3 = null
  try {
    s3 = createHetznerS3Client()
  } catch (e) {
    console.warn(`[worker-cl] media-sync-cl deshabilitado: ${e.message}`)
  }

  // `singletonKey` = UN job pendiente por entidad. Sin él, `boss.send` crea un
  // job nuevo en CADA llamada, así que cada barrido re-encolaba los mismos
  // anuncios: detail-cl acumuló 46.797 pendientes para ~3.700 anuncios reales,
  // dejando cualquier anuncio nuevo enterrado días detrás de sus duplicados.
  const enqueueDetail = (externalId, sourceUrl) =>
    boss.send(QUEUES.DETAIL, { externalId, sourceUrl }, { singletonKey: String(externalId) })

  // Si no hay S3 no hay worker de media-sync registrado (ver más abajo): encolar
  // ahí sería tirar jobs a un pozo sin fondo — se habían apilado 70.524. Se
  // omite en silencio y las fotos se sincronizan cuando el bucket esté puesto.
  const enqueueMediaSync = s3
    ? (listingId) => boss.send(QUEUES.MEDIA_SYNC, { listingId }, { singletonKey: String(listingId) })
    : async () => {}

  await boss.work(QUEUES.DETAIL, async (jobs) => {
    for (const job of jobs) {
      await handleDetailJob(dbClient, job.data, {
        enqueueMediaSync: enqueueMediaSync,
      })
    }
  })

  if (s3) {
    await boss.work(QUEUES.MEDIA_SYNC, async (jobs) => {
      for (const job of jobs) await handleMediaSyncJob(dbClient, job.data, { s3 })
    })
  }

  // Feeder de matches (blocking + scorer de par → listing_match_cl) cada 30min,
  // en cadencia propia por ser O(n²) por comuna. El clustering Nivel 2 (abajo)
  // consume sus confirmados en la siguiente pasada.
  await boss.work(QUEUES.MATCH_FEEDER, async () => { await handleMatchFeederJob(dbClient) })
  await boss.schedule(QUEUES.MATCH_FEEDER, '13,43 * * * *')

  // Pipeline de dedup completo (Nivel 1 → Nivel 2 → corredoras) cada 15min. Se
  // salta la corrida si una reconstrucción de property_cl (runStartupFixesCl /
  // rebuild manual) tiene tomado el lock consultivo, para no interbloquearse.
  await boss.work(QUEUES.DEDUP_CLUSTER, async () => {
    const { rows } = await dbClient.query('SELECT pg_try_advisory_lock($1) AS ok', [DEDUP_ADVISORY_LOCK_KEY])
    if (!rows[0].ok) { console.log('[dedup-cluster] omitido: reconstrucción de property_cl en curso'); return }
    try { await handleDedupClusterJob(dbClient) }
    finally { await dbClient.query('SELECT pg_advisory_unlock($1)', [DEDUP_ADVISORY_LOCK_KEY]) }
  })
  await boss.schedule(QUEUES.DEDUP_CLUSTER, '*/15 * * * *')

  // broker-enrich queda como cola on-demand (boss.send), sin schedule propio: el
  // refresco periódico de corredoras ya lo hace el pipeline de dedup-cluster.
  await boss.work(QUEUES.BROKER_ENRICH, async () => { await handleBrokerEnrichJob(dbClient) })

  // Discovery (H1): el scheduler lee scrape_targets_cl y encola un barrido por
  // comuna `enabled` vencida; cada discovery-cl pagina el listado y encola los
  // detail-cl nuevos. Config-driven — activar más comunas es un UPDATE, sin código.
  await boss.work(QUEUES.DISCOVERY, async (jobs) => {
    for (const job of jobs) {
      await handleDiscoveryJob(dbClient, job.data, {
        enqueueDetail: enqueueDetail,
      })
    }
  })

  await boss.work(QUEUES.DISCOVERY_SCHEDULER, async () => {
    await handleDiscoverySchedulerJob(dbClient, {
      enqueueDiscovery: (target) => boss.send(QUEUES.DISCOVERY, { target }),
    })
  })
  await boss.schedule(QUEUES.DISCOVERY_SCHEDULER, '*/15 * * * *')

  // Webs propias de corredoras (H21): el scheduler lee corredora_web_targets_cl
  // y encola un crawl por web `enabled` vencida (cadencia suave, 24h por defecto).
  // Cada crawl inserta las fichas como agency_web; el Nivel 1.5 del dedup-cluster
  // las une al anuncio de PI por código interno.
  await boss.work(QUEUES.CORREDORA_WEB, async (jobs) => {
    for (const job of jobs) {
      await handleCorredoraWebCrawlJob(dbClient, job.data, {
        enqueueMediaSync: enqueueMediaSync,
      })
    }
  })

  await boss.work(QUEUES.CORREDORA_WEB_SCHEDULER, async () => {
    await handleCorredoraWebSchedulerJob(dbClient, {
      enqueueCrawl: (target) => boss.send(QUEUES.CORREDORA_WEB, { target }),
    })
  })
  // Cada hora basta: la cadencia real la pone interval_hours de cada target (24h).
  await boss.schedule(QUEUES.CORREDORA_WEB_SCHEDULER, '7 * * * *')

  console.log(`[worker-cl] arrancado. Colas: ${Object.values(QUEUES).join(', ')}`)

  // Correcciones de datos puntuales (una sola vez, marcadas en data_fixes_cl):
  // des-fusionar property_cl agrupados de más (falso positivo del dedup ya
  // corregido) y re-scrapear fichas con superficie/fotos viejas. En segundo plano
  // y con su PROPIA conexión (no envolver las colas en su transacción); nunca
  // tumba el worker si algo falla.
  runStartupFixesCl().catch((e) => console.error('[startup-fix] error:', e))

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
