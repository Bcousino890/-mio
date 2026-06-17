#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// casafari-mio · scrape-zone.mjs
//
// Recorre TODOS los anuncios de una zona de Idealista (lista paginada) y, por
// cada uno, descarga su ficha completa (precio, m², habitaciones, baños,
// coordenadas del mapa, fotos, anunciante, descripción y características) y los
// hace upsert en la tabla `listings`.
//
// Uso:
//   node scrape-zone.mjs --zone madrid/barrio-de-salamanca/goya --op rent
//   node scrape-zone.mjs --zone madrid/barrio-de-salamanca/goya --op sale --dry-run --limit 3
//
// Flags:
//   --zone <slug>     slug de Idealista (obligatorio)
//   --op <rent|sale>  operación (def. rent)
//   --max-pages N     tope de páginas de listado (def. 60 = tope del portal)
//   --limit N         en dry-run, nº máx de fichas a procesar
//   --dry-run         no escribe en BD; imprime el JSON parseado
//   --no-proxy        ignora el proxy aunque esté configurado
//   --retries N       reintentos por ficha antes de darla por fallida (def. 4)
//   --fail-log <path> dónde guardar los external_id que fallaron tras agotar
//                      reintentos (def. <emit-app o output>.failed.json)
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { fetchHtml, SLEEP } from './lib/fetch.mjs'
import { parseListPage, parseDetailPage, parseTotalCount } from './lib/parse.mjs'
import { toAppListing } from './lib/to-listing.mjs'

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return def
  const next = process.argv[i + 1]
  return next && !next.startsWith('--') ? next : true
}

const ZONE = arg('zone')
const OP = arg('op', 'rent')
const MAX_PAGES = Number(arg('max-pages', 60))
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity
const DRY = !!arg('dry-run')
const USE_PROXY = !arg('no-proxy')
const EMIT_APP = arg('emit-app')   // ruta donde volcar el JSON con tipo Listing[]
const RETRIES = Number(arg('retries', 4))
const FAIL_LOG = arg('fail-log', (EMIT_APP || 'scraper/output/scrape') + '.failed.json')

if (!ZONE) {
  console.error('✗ Falta --zone (p.ej. madrid/barrio-de-salamanca/goya)')
  process.exit(1)
}

const OP_PATH = OP === 'sale' ? 'venta-viviendas' : 'alquiler-viviendas'
const BASE = `https://www.idealista.com/${OP_PATH}/${ZONE}/`

// Pausa aleatoria entre peticiones para no martillear el portal.
const jitter = () => SLEEP(900 + Math.floor(Math.random() * 1100))

// Reintenta una petición HTML con backoff exponencial (2s, 4s, 8s, 16s...).
// Nunca tira una propiedad a la basura por un fallo puntual de red/bloqueo.
async function fetchWithRetry(url, label, retries = RETRIES) {
  let lastReason = 'desconocido'
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetchHtml(url, { useProxy: USE_PROXY })
    if (res.ok) return res
    lastReason = res.reason
    if (attempt < retries) {
      const backoffMs = 2000 * 2 ** (attempt - 1)
      console.error(`    ⟳ ${label}: intento ${attempt}/${retries} falló (${res.reason}), reintentando en ${backoffMs / 1000}s…`)
      await SLEEP(backoffMs)
    }
  }
  console.error(`    ✗ ${label}: agotados ${retries} intentos (${lastReason})`)
  return { ok: false, reason: lastReason }
}

async function collectListings() {
  const seen = new Map()
  let total = null
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? BASE : `${BASE}pagina-${page}.htm`
    const res = await fetchWithRetry(url, `página ${page}`)
    if (!res.ok) {
      console.error(`  ✗ página ${page}: ${res.reason}`)
      break
    }
    if (total == null) {
      total = parseTotalCount(res.html)
      console.error(`  · ${total ?? '?'} resultados declarados en ${ZONE} (${OP})`)
    }
    const items = parseListPage(res.html)
    if (items.length === 0) break
    let added = 0
    for (const it of items) {
      if (!seen.has(it.external_id)) { seen.set(it.external_id, it); added++ }
    }
    console.error(`  · página ${page}: ${items.length} anuncios (${added} nuevos, ${seen.size} total)`)
    if (added === 0) break
    if (seen.size >= LIMIT) break
    await jitter()
  }
  return { items: [...seen.values()].slice(0, LIMIT === Infinity ? undefined : LIMIT), total }
}

async function enrich(item) {
  const res = await fetchWithRetry(item.source_url, `ficha ${item.external_id}`)
  if (!res.ok) {
    return { ok: false, external_id: item.external_id, reason: res.reason }
  }
  const detail = await parseDetailPage(res.html, item.external_id)
  // El precio de la ficha manda; si falta, usamos el de la lista.
  if (detail.price == null) detail.price = item.price
  if (detail.advertiser_name == null) detail.advertiser_name = item.advertiser_name
  return { ok: true, detail }
}

async function upsertAll(rows) {
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  let inserted = 0, updated = 0
  for (const r of rows) {
    const q = `
      INSERT INTO listings (
        portal, source_type, external_id, source_url, operation,
        advertiser_type, advertiser_name, price, bedrooms, bathrooms,
        square_meters, zone_raw, address, latitude, longitude, blur_radius_m,
        description, features, photos, cover_phash, photo_phashes, status, is_active, last_seen_at, updated_at,
        agency_url, agency_crm, agency_reference_id, agency_domain
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,
        $20,$21::text[], 'active', true, now(), now(),
        $22,$23,$24,$25
      )
      ON CONFLICT (portal, external_id) DO UPDATE SET
        price = EXCLUDED.price,
        advertiser_type = EXCLUDED.advertiser_type,
        advertiser_name = EXCLUDED.advertiser_name,
        bedrooms = EXCLUDED.bedrooms,
        bathrooms = EXCLUDED.bathrooms,
        square_meters = EXCLUDED.square_meters,
        address = EXCLUDED.address,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        description = EXCLUDED.description,
        features = EXCLUDED.features,
        photos = EXCLUDED.photos,
        cover_phash = EXCLUDED.cover_phash,
        photo_phashes = EXCLUDED.photo_phashes,
        agency_url = EXCLUDED.agency_url,
        agency_crm = EXCLUDED.agency_crm,
        agency_reference_id = EXCLUDED.agency_reference_id,
        agency_domain = EXCLUDED.agency_domain,
        status = 'active', is_active = true,
        last_seen_at = now(), updated_at = now()
      RETURNING (xmax = 0) AS inserted`
    const vals = [
      r.portal, r.source_type, r.external_id, r.source_url, r.operation,
      r.advertiser_type, r.advertiser_name, r.price, r.bedrooms, r.bathrooms,
      r.square_meters, ZONE, r.address, r.latitude, r.longitude, r.blur_radius_m,
      r.description, JSON.stringify(r.features), JSON.stringify(r.photos),
      r.cover_phash, r.photo_phashes,
      r.agency_url, r.agency_crm, r.agency_reference_id, r.agency_domain,
    ]
    const { rows: rr } = await client.query(q, vals)
    if (rr[0]?.inserted) inserted++; else updated++
  }
  await client.end()
  return { inserted, updated }
}

async function main() {
  console.error(`▶ Scrape ${ZONE} · ${OP} · ${DRY ? 'DRY-RUN' : 'BD'}${USE_PROXY ? '' : ' · sin proxy'}`)

  let items, total
  // Si se pasó --retry-failed, sólo reintentamos los external_id que quedaron
  // pendientes de una corrida anterior (no se recorre el listado de nuevo).
  const retryFailedPath = arg('retry-failed')
  if (retryFailedPath) {
    const prevFailed = JSON.parse(readFileSync(retryFailedPath, 'utf8'))
    items = prevFailed.map((f) => ({ external_id: f.external_id, source_url: f.source_url, price: null, advertiser_name: null }))
    total = items.length
    console.error(`▶ Reintentando ${items.length} fichas fallidas de ${retryFailedPath}`)
  } else {
    ;({ items, total } = await collectListings())
  }
  console.error(`▶ ${items.length} anuncios a enriquecer`)

  const rows = []
  const failed = []
  for (let i = 0; i < items.length; i++) {
    const result = await enrich(items[i])
    if (result.ok) {
      const detail = result.detail
      rows.push(detail)
      console.error(`    ✓ [${i + 1}/${items.length}] ${detail.external_id} · ${detail.price ?? '?'} € · ${detail.square_meters ?? '?'} m² · ${detail.photos.length} fotos · ${detail.latitude ? 'geo✓' : 'geo✗'}`)
    } else {
      failed.push({ external_id: result.external_id, source_url: items[i].source_url, reason: result.reason })
    }
    await jitter()
  }

  if (failed.length > 0) {
    writeFileSync(FAIL_LOG, JSON.stringify(failed, null, 2))
    console.error(`⚠ ${failed.length} fichas no se pudieron scrapear tras ${RETRIES} intentos. IDs guardados en ${FAIL_LOG}`)
    console.error(`  Reintenta con: node scrape-zone.mjs --zone ${ZONE} --op ${OP} --retry-failed ${FAIL_LOG} --emit-app <output>`)
  } else if (existsSync(FAIL_LOG) && !retryFailedPath) {
    // Corrida limpia sin fallos: no dejamos un fail-log obsoleto de una corrida anterior.
    writeFileSync(FAIL_LOG, JSON.stringify([], null, 2))
  }

  if (EMIT_APP) {
    const listings = rows.map((r) => toAppListing(r, { zoneSlug: ZONE }))
    writeFileSync(EMIT_APP, JSON.stringify(listings, null, 2))
    console.error(`✅ ${listings.length} anuncios escritos en ${EMIT_APP} (tipo Listing[])`)
    return
  }

  if (DRY) {
    console.log(JSON.stringify({ zone: ZONE, operation: OP, total, scraped: rows.length, rows }, null, 2))
    return
  }

  if (!process.env.DATABASE_URL) {
    console.error('✗ Falta DATABASE_URL para escribir en BD (o usa --dry-run)')
    process.exit(1)
  }
  const { inserted, updated } = await upsertAll(rows)
  console.error(`✅ Hecho: ${inserted} nuevos, ${updated} actualizados en \`listings\``)
}

main().catch((e) => { console.error(e); process.exit(1) })
