#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// download-catastral-gpkg.mjs — Descarga GeoPackages de polígonos prediales
// desde catastral.cl (proyecto Tremen, datos vectorizados del SII, 9.4M predios).
//
// USO:
//   node scraper/download-catastral-gpkg.mjs --out /data/gpkg
//   node scraper/download-catastral-gpkg.mjs --out /data/gpkg --comunas 15108,15131
//
// Los GeoPackages se cargan en cadastre_parcels_cl con ogr2ogr (ver abajo).
// ─────────────────────────────────────────────────────────────────────────────
import { createWriteStream, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

// ─── URLs de descarga catastral.cl ───────────────────────────────────────────
// Patrón detectado: archivos servidos desde storage de Hetzner S3 (22.8 GB total)
// según el repo crishernandezmaps/roles-backend. URL base a confirmar contra el
// sitio — el script prueba los patrones conocidos en orden.
const BASE_CANDIDATES = [
  'https://storage.catastral.cl',
  'https://data.catastral.cl',
  'https://catastral.cl/data',
]

// Semestre activo — S1-2026 o S2-2025 si aún no está disponible
const SEMESTRES = ['2026_S1', '2025_S2', '2025_S1']

// Comunas prioritarias con sus códigos SII y nombres de archivo esperados
const COMUNAS = [
  { code: '15131', slug: 'vitacura',     nombre: 'Vitacura' },
  { code: '15108', slug: 'las_condes',   nombre: 'Las Condes' },
  { code: '15111', slug: 'lo_barnechea', nombre: 'Lo Barnechea' },
  { code: '13119', slug: 'providencia',  nombre: 'Providencia' },
  { code: '13120', slug: 'nunoa',        nombre: 'Ñuñoa' },
  { code: '13106', slug: 'la_reina',     nombre: 'La Reina' },
  { code: '13101', slug: 'santiago',     nombre: 'Santiago' },
  { code: '13301', slug: 'colina',       nombre: 'Colina' },
]

const { values: args } = parseArgs({
  options: {
    out:     { type: 'string', default: '/data/gpkg' },
    comunas: { type: 'string' },
    semestre:{ type: 'string', default: '2026_S1' },
    'dry-run': { type: 'boolean', default: false },
  },
  strict: false,
})

const OUT_DIR = args.out
mkdirSync(OUT_DIR, { recursive: true })

const comunasFilter = args.comunas ? new Set(args.comunas.split(',')) : null
const targetComunas = comunasFilter
  ? COMUNAS.filter(c => comunasFilter.has(c.code) || comunasFilter.has(c.slug))
  : COMUNAS

async function tryDownload(url, destPath) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Referer': 'https://catastral.cl/',
    },
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) return false
  const contentType = res.headers.get('content-type') ?? ''
  // Rechazar HTML (página de error) disfrazada de descarga
  if (contentType.includes('text/html')) return false

  const dest = createWriteStream(destPath)
  await pipeline(Readable.fromWeb(res.body), dest)
  return true
}

// Genera candidatos de URL para un GeoPackage dado el código de comuna y semestre
function urlCandidates(comuna, semestre) {
  const { code, slug } = comuna
  const urls = []
  for (const base of BASE_CANDIDATES) {
    urls.push(
      `${base}/${semestre}/${code}.gpkg`,
      `${base}/${semestre}/${slug}.gpkg`,
      `${base}/gpkg/${semestre}/${code}.gpkg`,
      `${base}/gpkg/${semestre}/${slug}.gpkg`,
      `${base}/descargas/${semestre}/${code}.gpkg`,
      `${base}/catastro/${semestre}/${code}.gpkg`,
      // Sin semestre (archivo único actualizado)
      `${base}/${code}.gpkg`,
      `${base}/${slug}.gpkg`,
    )
  }
  return urls
}

async function downloadComuna(comuna) {
  const semestre = args.semestre
  const destPath = join(OUT_DIR, `${comuna.code}_${semestre}.gpkg`)

  if (existsSync(destPath)) {
    console.log(`[${comuna.nombre}] Ya existe: ${destPath}`)
    return true
  }

  const candidates = urlCandidates(comuna, semestre)

  if (args['dry-run']) {
    console.log(`[${comuna.nombre}] Probaría URLs:`)
    candidates.slice(0, 4).forEach(u => console.log('  ', u))
    return true
  }

  for (const url of candidates) {
    process.stdout.write(`[${comuna.nombre}] Probando ${url} ... `)
    try {
      const ok = await tryDownload(url, destPath)
      if (ok) {
        console.log('✓')
        console.log(`  Guardado en ${destPath}`)
        console.log(`  Cargar con: ogr2ogr -f PostgreSQL "$DATABASE_URL" ${destPath} -nln cadastre_parcels_cl -append`)
        return true
      }
      console.log('404/error')
    } catch (e) {
      console.log(`error: ${e.message}`)
    }
  }

  console.warn(`[${comuna.nombre}] ✗ No se encontró GeoPackage en ninguna URL candidata`)
  console.warn(`  Descarga manual: https://catastral.cl → buscar "${comuna.nombre}"`)
  return false
}

async function main() {
  console.log(`Descarga GeoPackages catastral.cl — semestre ${args.semestre}`)
  console.log(`Destino: ${OUT_DIR}`)
  console.log(`Comunas: ${targetComunas.map(c => c.nombre).join(', ')}\n`)

  let ok = 0, fail = 0
  for (const comuna of targetComunas) {
    const success = await downloadComuna(comuna)
    if (success) ok++ ; else fail++
  }

  console.log(`\nResumen: ${ok} descargados, ${fail} fallidos`)
  if (fail > 0) {
    console.log('\nPara las comunas fallidas, descarga manualmente desde:')
    console.log('  https://catastral.cl')
    console.log('Luego carga con ogr2ogr:')
    console.log('  ogr2ogr -f PostgreSQL "$DATABASE_URL" archivo.gpkg -nln cadastre_parcels_cl -append')
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
