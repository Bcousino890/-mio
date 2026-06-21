#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// casafari-mio · scrape-multi-portal.mjs
//
// Scraper for multiple real estate portals (Idealista, Fotocasa, Habitaclia)
// with automatic watermark removal for agency websites using known CRM patterns.
//
// Uso:
//   node scrape-multi-portal.mjs --portals idealista,fotocasa --zone madrid/barrio-de-salamanca --op rent --dry-run
//   node scrape-multi-portal.mjs --portals habitaclia --zone madrid/barrio-de-salamanca --op sale
//
// Flags:
//   --portals <csv>   comma-separated portals to scrape (idealista,fotocasa,habitaclia)
//   --zone <slug>     zone slug (required)
//   --op <rent|sale>  operation (default: rent)
//   --limit N         max listings to process per portal
//   --dry-run         don't write to DB; just log results
//   --no-proxy        ignore proxy even if configured
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from 'node:fs'
import { fetchHtml, SLEEP } from './lib/fetch.mjs'
import { parseListPage, parseDetailPage } from './lib/parse.mjs'
import {
  parseListPage as parseListPagePI,
  parseDetailPage as parseDetailPagePI,
} from './lib/parse-portalinmobiliario.mjs'
import { toAppListing, toAppListingCl } from './lib/to-listing.mjs'
import { cleanPhotos } from './lib/watermark-removal.mjs'
import { getUfRateCl } from './lib/uf-rate-cl.mjs'

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return def
  const next = process.argv[i + 1]
  return next && !next.startsWith('--') ? next : true
}

const PORTALS = (arg('portals') || 'idealista').split(',').map(p => p.trim())
const ZONE = arg('zone')
const OP = arg('op', 'rent')
const LIMIT = arg('limit') ? Number(arg('limit')) : Infinity
const DRY = !!arg('dry-run')
const USE_PROXY = !arg('no-proxy')
const MAX_PAGES = Number(arg('max-pages', 60))

if (!ZONE) {
  console.error('✗ Falta --zone')
  process.exit(1)
}

const jitter = () => SLEEP(900 + Math.random() * 1100)

// ── Portal-specific configuration ─────────────────────────────────────────
const PORTAL_CONFIG = {
  idealista: {
    baseUrl: (op) => `https://www.idealista.com/${op === 'sale' ? 'venta-viviendas' : 'alquiler-viviendas'}`,
    parse: parseListPage,
    ua: 'WhatsApp/2.23.20.0',
    watermarkHint: 'idealista',
  },
  fotocasa: {
    baseUrl: (op) => `https://www.fotocasa.es/${op === 'sale' ? 'venta' : 'alquiler'}/viviendas`,
    parse: (html) => {
      // Fotocasa has different HTML structure; for now stub it.
      console.log('  ⚠ Fotocasa parsing not yet implemented (different HTML structure)')
      return []
    },
    ua: 'Mozilla/5.0 (compatible; CasafariBot/1.0)',
    watermarkHint: 'fotocasa',
  },
  habitaclia: {
    baseUrl: (op) => `https://www.habitaclia.com/${op === 'sale' ? 'venta' : 'alquiler'}/viviendas`,
    parse: (html) => {
      // Habitaclia has different HTML structure; for now stub it.
      console.log('  ⚠ Habitaclia parsing not yet implemented (different HTML structure)')
      return []
    },
    ua: 'Mozilla/5.0 (compatible; CasafariBot/1.0)',
    watermarkHint: 'habitaclia',
  },
  // Portalinmobiliario.com (Mercado Libre Chile) — módulo Chile.
  // baseUrl/estructura de URL de listado NO CONFIRMADOS contra el sitio real
  // (el sandbox de investigación bloqueó el fetch directo); a validar en el
  // spike de producción. `zone` aquí se espera como slug de comuna (ver
  // scraper/lib/chile-comunas.mjs), no como slug jerárquico tipo Idealista.
  portalinmobiliario: {
    baseUrl: (op) => `https://www.portalinmobiliario.com/${op === 'sale' ? 'venta' : 'arriendo'}/propiedades`,
    parse: parseListPagePI,
    profile: 'portalinmobiliario',
    watermarkHint: 'portalinmobiliario',
  },
}

async function scrapePortal(portal, zone, op) {
  if (!PORTAL_CONFIG[portal]) {
    console.error(`✗ Portal desconocido: ${portal}`)
    return []
  }

  const config = PORTAL_CONFIG[portal]
  const baseUrl = config.baseUrl(op)
  const url = `${baseUrl}/${zone}/`
  const allListings = []
  const seen = new Set()

  console.log(`\n🔍 Scraping ${portal.toUpperCase()} · ${zone} · ${op}`)
  console.log(`   Base URL: ${url}\n`)

  for (let page = 1; page <= MAX_PAGES && allListings.length < LIMIT; page++) {
    const pageUrl = page === 1 ? url : `${url}pagina-${page}.htm`

    console.log(`  → Página ${page}...`)
    const res = await fetchHtml(pageUrl, { useProxy: USE_PROXY, profile: config.profile })

    if (!res.ok) {
      console.error(`    ✗ Error: ${res.reason}`)
      break
    }

    const listings = config.parse(res.html)
    if (!listings || listings.length === 0) {
      console.log(`    (No hay más resultados)`)
      break
    }

    for (const listing of listings) {
      if (allListings.length >= LIMIT) break
      if (seen.has(listing.external_id)) continue
      seen.add(listing.external_id)

      console.log(`    ✓ ${listing.external_id} · ${listing.title.slice(0, 50)}`)
      allListings.push({
        ...listing,
        portal,
        zone,
      })
    }

    await jitter()
  }

  console.log(`  → Descargadas ${allListings.length} fichas`)
  return allListings
}

async function scrapeDetailPages(listings, portal) {
  const config = PORTAL_CONFIG[portal]
  const detailed = []

  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i]
    console.log(`    [${i + 1}/${listings.length}] ${listing.external_id}...`)

    // Idealista / Portalinmobiliario detail page scraping
    if (portal === 'idealista' || portal === 'portalinmobiliario') {
      const res = await fetchHtml(listing.source_url, { useProxy: USE_PROXY, profile: config.profile })
      if (!res.ok) {
        console.error(`      ✗ ${res.reason}`)
        continue
      }

      const detailParser = portal === 'portalinmobiliario' ? parseDetailPagePI : parseDetailPage
      const detail = await detailParser(res.html, listing.external_id)
      if (detail && detail.photos) {
        // Apply watermark removal
        detail.photos = cleanPhotos(detail.photos, config.watermarkHint)
      }
      detailed.push(detail ?? listing)
    } else {
      console.log(`      ⚠ Detail parsing for ${portal} not yet implemented`)
      detailed.push(listing)
    }

    await jitter()
  }

  return detailed
}

// ── Persistencia en BD (solo Chile/portalinmobiliario) ──────────────────────
// España (idealista/fotocasa/habitaclia) sigue exactamente igual que antes de
// este cambio: solo vuelca a JSON (ver `scrape-zone.mjs` para el flujo real
// de upsert a `listings` cuando se necesita, que es un script aparte). Este
// orquestador (`scrape-multi-portal.mjs`) nunca tuvo un upsert a BD para
// España — el log `(Upsert a BD no implementado en esta versión)` cubría
// ambos países por igual; cerramos la brecha solo para Chile/`listings_cl`,
// que es el gap explícito que pedía esta tarea.

/**
 * Resuelve el nombre de comuna (ya normalizado por normalizeComuna() dentro
 * de toAppListingCl, expuesto aquí como `listing.comuna`) a chile_comunas.id.
 * Cachea en memoria de proceso — mismo patrón que ZoneResolverCache de
 * zone-resolver.mjs (España), pero mucho más simple porque comuna es un
 * único nivel plano (no hay jerarquía distrito→zona→subzona que resolver).
 */
const comunaIdCache = new Map()
async function resolveComunaId(client, comunaName) {
  if (!comunaName) return null
  if (comunaIdCache.has(comunaName)) return comunaIdCache.get(comunaName)

  const { rows } = await client.query('SELECT id FROM chile_comunas WHERE name = $1 LIMIT 1', [comunaName])
  const id = rows[0]?.id ?? null
  comunaIdCache.set(comunaName, id)
  if (!id) {
    console.warn(`    ⚠ Comuna no encontrada en chile_comunas: "${comunaName}" (listings_cl.comuna_id quedará NULL)`)
  }
  return id
}

/**
 * Upsert de un listing de Chile (forma de salida de toAppListingCl) en
 * `listings_cl`, por (portal, external_id) — mismo patrón de
 * `upsertOne()`/`ON CONFLICT` que scrape-zone.mjs usa para `listings`
 * (España), adaptado a las columnas de 0028_listings_cl.sql.
 */
async function upsertListingCl(client, listing) {
  const comunaId = await resolveComunaId(client, listing.comuna ?? null)

  const q = `
    INSERT INTO listings_cl (
      portal, source_type, external_id, source_url, operation,
      advertiser_type, advertiser_name,
      price, price_uf, uf_rate, uf_rate_date, currency,
      bedrooms, bathrooms, square_meters, property_type,
      comuna_id, comuna_raw, localidad, address, exact_address,
      latitude, longitude,
      description, features, photos,
      status, is_active, last_seen_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,
      $6,$7,
      $8,$9,$10,$11,$12,
      $13,$14,$15,$16,
      $17,$18,$19,$20,$21,
      $22,$23,
      $24,$25::jsonb,$26::jsonb,
      'active', true, now(), now()
    )
    ON CONFLICT (portal, external_id) DO UPDATE SET
      price = EXCLUDED.price,
      price_uf = EXCLUDED.price_uf,
      uf_rate = EXCLUDED.uf_rate,
      uf_rate_date = EXCLUDED.uf_rate_date,
      currency = EXCLUDED.currency,
      advertiser_type = EXCLUDED.advertiser_type,
      advertiser_name = EXCLUDED.advertiser_name,
      bedrooms = EXCLUDED.bedrooms,
      bathrooms = EXCLUDED.bathrooms,
      square_meters = EXCLUDED.square_meters,
      property_type = EXCLUDED.property_type,
      comuna_id = EXCLUDED.comuna_id,
      comuna_raw = EXCLUDED.comuna_raw,
      localidad = EXCLUDED.localidad,
      address = EXCLUDED.address,
      exact_address = EXCLUDED.exact_address,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      description = EXCLUDED.description,
      features = EXCLUDED.features,
      photos = EXCLUDED.photos,
      status = 'active', is_active = true,
      last_seen_at = now(), updated_at = now()
    RETURNING (xmax = 0) AS inserted`

  const vals = [
    listing.portal, listing.source_type, listing.id, listing.source_url, listing.operation,
    listing.advertiser_type, listing.advertiser_name,
    listing.price, listing.price_uf, listing.uf_rate, listing.uf_rate_date, listing.currency,
    listing.bedrooms, listing.bathrooms, listing.square_meters, listing.property_type ?? null,
    comunaId, listing.comuna ?? null, listing.localidad ?? null, listing.address ?? null, listing.exact_address ?? null,
    listing.latitude, listing.longitude,
    listing.description ?? null, JSON.stringify(listing.features ?? []), JSON.stringify(listing.photos ?? []),
  ]

  const { rows } = await client.query(q, vals)
  return !!rows[0]?.inserted
}

/**
 * Vuelca `allDetailed` a BD. Solo procesa anuncios de portalinmobiliario
 * (listing.portal === 'portalinmobiliario') → listings_cl; otros portales
 * (España) se ignoran aquí a propósito, igual que el comportamiento previo
 * (JSON-only) — ver comentario de cabecera de esta sección.
 */
async function upsertToDb(allDetailed) {
  const clListings = allDetailed.filter((l) => l.portal === 'portalinmobiliario')
  if (clListings.length === 0) {
    console.log(`   (Sin anuncios de portalinmobiliario en esta corrida; España sigue solo en JSON)`)
    return
  }

  if (!process.env.DATABASE_URL) {
    console.error(`   ✗ Falta DATABASE_URL: no se puede hacer upsert de ${clListings.length} anuncios CL a listings_cl`)
    return
  }

  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  let inserted = 0
  let updated = 0
  let failed = 0
  try {
    for (const listing of clListings) {
      try {
        const wasInserted = await upsertListingCl(client, listing)
        if (wasInserted) inserted++; else updated++
      } catch (err) {
        failed++
        console.error(`   ✗ Error en upsert de ${listing.id}: ${err.message}`)
      }
    }
  } finally {
    await client.end()
  }

  console.log(`   💾 listings_cl: ${inserted} insertados, ${updated} actualizados${failed > 0 ? `, ${failed} fallidos` : ''}`)
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║ casafari-mio · Multi-Portal Scraper                                  ║
║ Portals: ${PORTALS.join(', ').padEnd(45)} ║
╚══════════════════════════════════════════════════════════════════════╝
  `)

  // Tasa UF→CLP del día: se pide UNA sola vez por corrida (memoizada en
  // uf-rate-cl.mjs) y se reutiliza para todos los anuncios de Chile, en vez
  // de pedirla una vez por anuncio. Solo tiene sentido si vamos a scrapear
  // portalinmobiliario en esta corrida; para corridas 100% España no hace
  // ninguna petición de red de más.
  let ufRateInfo = null
  if (PORTALS.includes('portalinmobiliario')) {
    const ufResult = await getUfRateCl()
    if (ufResult.ok) {
      ufRateInfo = { ufRate: ufResult.rate, ufRateDate: ufResult.date }
      console.log(`\n💱 UF del día (mindicador.cl): ${ufResult.rate} CLP (${ufResult.date})`)
    } else {
      // Degradar con gracia: sin tasa UF, los anuncios publicados en UF
      // quedarán con price=0/uf_rate=null (ver resolvePriceClp en
      // to-listing.mjs) en vez de tumbar toda la corrida — los anuncios ya
      // publicados en CLP directo no se ven afectados.
      console.warn(`\n⚠ No se pudo obtener la tasa UF (${ufResult.reason}); anuncios en UF quedarán sin precio CLP resuelto`)
    }
  }

  let allDetailed = []

  for (const portal of PORTALS) {
    try {
      const listings = await scrapePortal(portal, ZONE, OP)
      console.log(`\n  → Descargando detalles...`)
      const detailed = await scrapeDetailPages(listings, portal)

      const toListing = portal === 'portalinmobiliario' ? toAppListingCl : toAppListing
      const mapOpts = portal === 'portalinmobiliario'
        ? { zoneSlug: ZONE, ...(ufRateInfo ?? {}) }
        : { zoneSlug: ZONE }
      allDetailed = allDetailed.concat(
        detailed.map((d) => toListing(d, mapOpts))
      )
    } catch (err) {
      console.error(`✗ Error en ${portal}:`, err.message)
    }
  }

  console.log(`\n✅ Total: ${allDetailed.length} propiedades`)

  if (!DRY && allDetailed.length > 0) {
    await upsertToDb(allDetailed)
  }

  if (allDetailed.length > 0) {
    const outFile = `/tmp/scraped-${Date.now()}.json`
    writeFileSync(outFile, JSON.stringify(allDetailed, null, 2))
    console.log(`   📄 JSON: ${outFile}`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
