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
import { toAppListing } from './lib/to-listing.mjs'
import { cleanPhotos } from './lib/watermark-removal.mjs'

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
    const res = await fetchHtml(pageUrl, { useProxy: USE_PROXY })

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

    // Idealista detail page scraping
    if (portal === 'idealista') {
      const res = await fetchHtml(listing.source_url, { useProxy: USE_PROXY })
      if (!res.ok) {
        console.error(`      ✗ ${res.reason}`)
        continue
      }

      const detail = await parseDetailPage(res.html, listing.external_id)
      if (detail && detail.photos) {
        // Apply watermark removal
        detail.photos = cleanPhotos(detail.photos, config.watermarkHint)
      }
      detailed.push(detail)
    } else {
      console.log(`      ⚠ Detail parsing for ${portal} not yet implemented`)
      detailed.push(listing)
    }

    await jitter()
  }

  return detailed
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║ casafari-mio · Multi-Portal Scraper                                  ║
║ Portals: ${PORTALS.join(', ').padEnd(45)} ║
╚══════════════════════════════════════════════════════════════════════╝
  `)

  let allDetailed = []

  for (const portal of PORTALS) {
    try {
      const listings = await scrapePortal(portal, ZONE, OP)
      console.log(`\n  → Descargando detalles...`)
      const detailed = await scrapeDetailPages(listings, portal)

      allDetailed = allDetailed.concat(
        detailed.map((d) => toAppListing(d, { zoneSlug: ZONE }))
      )
    } catch (err) {
      console.error(`✗ Error en ${portal}:`, err.message)
    }
  }

  console.log(`\n✅ Total: ${allDetailed.length} propiedades`)

  if (!DRY && allDetailed.length > 0) {
    console.log(`   (Upsert a BD no implementado en esta versión)`)
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
