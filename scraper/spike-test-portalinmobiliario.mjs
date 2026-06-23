#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// spike-test-portalinmobiliario.mjs
//
// Fase 0 del Plan V2: valida en producción (desde el VPS, no desde un sandbox
// que bloquea el dominio) las hipótesis no confirmadas del parser:
//   - ¿Existe __NEXT_DATA__ / __PRELOADED_STATE__ / __INITIAL_STATE__?
//   - ¿Dónde aparece property_code, advertiser_id, video?
//   - ¿Hay 429/403/captcha sin proxy con la concurrencia configurada?
//
// Corre el parser real (lib/parse-portalinmobiliario.mjs) contra HTML real y
// guarda cada respuesta en disco para poder compartir fragmentos concretos
// sin pegar HTML completo en el chat.
//
// Uso:
//   # Opción A: IDs concretos (MLC-XXXX o solo el número)
//   node spike-test-portalinmobiliario.mjs --ids MLC-1847000513,1847000514
//
//   # Opción B: arrancar desde una página de listado y tomar los primeros N
//   node spike-test-portalinmobiliario.mjs \
//     --list-url "https://listado.portalinmobiliario.com/venta/departamento/region-metropolitana" \
//     --count 8
//
// Flags:
//   --ids <csv>        IDs concretos a probar (salta el listado)
//   --list-url <url>   página de listado de la que extraer IDs reales
//   --count N          cuántas fichas de detalle probar (default 8)
//   --delay MS         pausa entre requests secuenciales (default 1500)
//   --concurrency N    requests en paralelo (default 1 = secuencial; usar con
//                       cuidado, es justamente lo que mide si hay rate-limit)
//   --no-proxy         ignora PROXY_URL/PROXY_PROVIDER aunque esté configurado
//   --out <dir>        carpeta de salida (default ./spike-output)
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fetchHtml, SLEEP } from './lib/fetch.mjs'
import { parseListPage, parseDetailPage } from './lib/parse-portalinmobiliario.mjs'

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return def
  const next = process.argv[i + 1]
  return next && !next.startsWith('--') ? next : true
}

const IDS = arg('ids')
const LIST_URL = arg('list-url')
const COUNT = Number(arg('count', 8))
const DELAY = Number(arg('delay', 1500))
const CONCURRENCY = Number(arg('concurrency', 1))
const USE_PROXY = !arg('no-proxy')
const OUT_DIR = arg('out', './spike-output')

if (!IDS && !LIST_URL) {
  console.error('✗ Falta --ids MLC-XXX,MLC-YYY o --list-url <url de listado>')
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })

// CONFIRMADO (Fase 0, 11 fichas reales): __NEXT_DATA__/__PRELOADED_STATE__/
// __INITIAL_STATE__ NUNCA aparecen en este portal — esa hipótesis original
// era incorrecta. El blob real es __NORDIC_RENDERING_CTX__ (ver
// lib/parse-portalinmobiliario.mjs::extractNordicBlob). Se mantienen los
// otros tres por si el portal cambia de framework, pero no se espera que
// calcen nunca.
const BLOB_CHECKS = [
  ['__NORDIC_RENDERING_CTX__', /<script[^>]*id=["']__NORDIC_RENDERING_CTX__["']/i],
  ['__NEXT_DATA__', /<script[^>]*id=["']__NEXT_DATA__["']/i],
  ['__PRELOADED_STATE__', /window\.__PRELOADED_STATE__\s*=/i],
  ['__INITIAL_STATE__', /window\.__INITIAL_STATE__\s*=/i],
]

function diagnose(html) {
  const blobsFound = BLOB_CHECKS.filter(([, re]) => re.test(html)).map(([name]) => name)
  return {
    blobsFound,
    // Confirmado: property_code vive en seller_profile(.rex)?.bottom_extra_info,
    // y el video real solo aparece como `has_video`+URL de modal, nunca como
    // archivo embebido — estas pistas son solo un check rápido de presencia.
    hasPropertyIdHint: /C[oó]digo de la propiedad|"propertyCode"|"property_id"|data-property-code=/i.test(html),
    hasVideoHint: /"has_video"\s*:\s*true|videoUrl|video_url|\.mp4|\.webm|youtube\.com\/embed|player\.vimeo\.com/i.test(html),
    hasSellerHint: /"seller_profile"|"seller"\s*:\s*\{|advertiser_id|"nickname"/i.test(html),
    lengthKb: Math.round(html.length / 1024),
  }
}

async function fetchOne(label, url) {
  const t0 = Date.now()
  const res = await fetchHtml(url, { useProxy: USE_PROXY, profile: 'portalinmobiliario' })
  const ms = Date.now() - t0
  if (!res.ok) {
    console.log(`  ✗ ${label} → HTTP ${res.status} (${res.reason}) en ${ms}ms`)
    return { label, url, ok: false, status: res.status, ms }
  }
  const outFile = join(OUT_DIR, `${label}.html`)
  writeFileSync(outFile, res.html)
  const d = diagnose(res.html)
  console.log(`  ✓ ${label} → HTTP 200, ${d.lengthKb}KB en ${ms}ms → guardado en ${outFile}`)
  console.log(`     blobs: ${d.blobsFound.length ? d.blobsFound.join(', ') : '(ninguno encontrado)'}`)
  console.log(`     pistas: property_code=${d.hasPropertyIdHint} video=${d.hasVideoHint} seller=${d.hasSellerHint}`)
  return { label, url, ok: true, status: 200, ms, html: res.html, diag: d }
}

async function runPool(items, worker, concurrency) {
  const results = []
  let i = 0
  async function next() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await worker(items[idx], idx)
      if (concurrency === 1 && DELAY > 0 && i < items.length) await SLEEP(DELAY)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, next))
  return results
}

async function main() {
  console.log(`─── Fase 0 spike test · Portal Inmobiliario ───`)
  console.log(`Proxy: ${USE_PROXY ? (process.env.PROXY_URL || process.env.PROXY_PROVIDER || '(ninguno configurado)') : 'desactivado (--no-proxy)'}`)
  console.log(`Concurrencia: ${CONCURRENCY} · Delay: ${DELAY}ms\n`)

  let targets = []

  if (IDS) {
    targets = IDS.split(',').map((raw) => {
      const id = raw.trim().toUpperCase().startsWith('MLC') ? raw.trim().toUpperCase() : `MLC-${raw.trim()}`
      return { id, url: `https://www.portalinmobiliario.com/${id}` }
    })
  } else {
    console.log(`1. Fetch de página de listado: ${LIST_URL}`)
    const listRes = await fetchOne('_listado', LIST_URL)
    if (!listRes.ok) {
      console.error('✗ No se pudo obtener la página de listado, abortando.')
      process.exit(1)
    }
    const items = parseListPage(listRes.html)
    console.log(`   → parseListPage extrajo ${items.length} anuncios\n`)
    if (items.length === 0) {
      console.error('✗ parseListPage no encontró nada. Revisa manualmente spike-output/_listado.html')
      process.exit(1)
    }
    targets = items.slice(0, COUNT).map((it) => ({ id: it.external_id, url: it.source_url }))
  }

  console.log(`2. Fetch de ${targets.length} fichas de detalle:`)
  const results = await runPool(targets, (t) => fetchOne(t.id, t.url), CONCURRENCY)

  console.log(`\n3. Parseo con parseDetailPage (lib/parse-portalinmobiliario.mjs):`)
  const parsed = []
  for (const r of results) {
    if (!r.ok) continue
    const item = parseDetailPage(r.html, r.label)
    parsed.push(item)
    console.log(`  ${r.label}:`)
    console.log(`     property_code=${item?.property_code ?? 'NULL'}  advertiser_id=${item?.advertiser_id ?? 'NULL'}`)
    console.log(`     price=${item?.price ?? 'NULL'} ${item?.currency ?? ''}  bedrooms=${item?.bedrooms ?? 'NULL'}  m²=${item?.square_meters ?? 'NULL'}`)
    console.log(`     fotos=${item?.photos?.length ?? 0}  video=${item?.videos ?? 'NULL'}`)
    console.log(`     comuna=${item?.comuna ?? 'NULL'}  lat/lng=${item?.latitude ?? 'NULL'},${item?.longitude ?? 'NULL'}`)
  }

  const summaryFile = join(OUT_DIR, '_summary.json')
  writeFileSync(summaryFile, JSON.stringify({
    fetchResults: results.map((r) => ({ label: r.label, ok: r.ok, status: r.status, ms: r.ms, diag: r.diag })),
    parsed,
  }, null, 2))

  const okCount = results.filter((r) => r.ok).length
  const failCount = results.length - okCount
  console.log(`\n─── Resumen ───`)
  console.log(`OK: ${okCount}/${results.length}  ·  Fallidos: ${failCount}/${results.length}`)
  if (failCount > 0) {
    const statuses = results.filter((r) => !r.ok).map((r) => r.status)
    console.log(`Status codes de fallos: ${statuses.join(', ')}`)
  }
  console.log(`HTML crudo guardado en: ${OUT_DIR}/`)
  console.log(`Resumen JSON: ${summaryFile}`)
  console.log(`\nPara compartir hallazgos: pega la salida de este resumen, o el contenido`)
  console.log(`de _summary.json, o fragmentos puntuales de los .html guardados (ej. el`)
  console.log(`bloque <script id="__NEXT_DATA__"> de uno de ellos).`)
}

main().catch((err) => {
  console.error('✗ Error inesperado:', err)
  process.exit(1)
})
