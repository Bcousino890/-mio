#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ingest-minvu-suelo.mjs — ingesta el valor de suelo (UF/m² por zona) del
// Observatorio del Mercado de Suelo de MINVU (ide.minvu.cl, open data) en
// `mercado_agregado_cl` (migración 0057, fuente='minvu_suelo').
//
// MINVU publica indicadores de valor de suelo derivados de transacciones no
// agrícolas del SII. Es la señal pública de "mercado realizado" (nivel suelo/zona)
// que calibra el AVM — ver web/app/api/chile/avm/route.ts y
// docs/CBR-TRANSACCIONES-REPOS-2026.md. NO son precios de cierre por predio.
//
// DESCUBRIMIENTO (A0, 2026-07-12): ide.minvu.cl es un portal Esri ArcGIS Hub,
// no un GeoServer WFS clásico. Por eso soporta DOS fuentes:
//   --esri-url  <FeatureServer/MapServer layer URL>  (la vía real para MINVU)
//   --wfs-url + --layer                              (fallback GeoServer clásico)
//
// PASO A0 (verificar ANTES de correr en serio, con red a ide.minvu.cl abierta):
//   node scraper/a0-verify-fuentes.mjs                          # busca datasets
//   node scraper/a0-verify-fuentes.mjs --esri-describe "<url>"  # lista campos
//
// USO (Esri REST — vía real MINVU):
//   node scraper/ingest-minvu-suelo.mjs \
//     --esri-url "https://services.arcgis.com/.../FeatureServer/0" \
//     --field-valor <prop_uf_m2> [--field-zona <prop_zona>] \
//     [--field-comuna <prop_cod_comuna> | --comuna 13101] \
//     --periodo 2024 [--dry-run]
//
// USO (WFS clásico — fallback para otros portales):
//   node scraper/ingest-minvu-suelo.mjs \
//     --wfs-url https://otro/geoserver/wfs --layer <capa> \
//     --field-valor <prop_uf_m2> --comuna 13101 --periodo 2024 --dry-run
//
// Por defecto es --dry-run implícito si falta DATABASE_URL: descarga y valida,
// sin escribir. Env: MINVU_WFS_URL, MINVU_SUELO_LAYER, DATABASE_URL.
// ─────────────────────────────────────────────────────────────────────────────
import { parseArgs } from 'node:util'
import pg from 'pg'

const { Client } = pg
const UA = 'CasafariMIO/1.0 (+ingesta open data MINVU IDE)'
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms))

const { values } = parseArgs({
  options: {
    'esri-url': { type: 'string' },          // FeatureServer/MapServer layer URL (vía real MINVU)
    'wfs-url': { type: 'string' },           // fallback GeoServer clásico
    layer: { type: 'string' },
    'field-valor': { type: 'string' },      // propiedad GeoJSON con el UF/m²
    'field-zona': { type: 'string' },        // propiedad con el id de zona (opcional)
    'field-comuna': { type: 'string' },      // propiedad con el código de comuna (opcional)
    comuna: { type: 'string' },              // código SII fijo si la capa no lo trae
    periodo: { type: 'string' },
    'page-size': { type: 'string' },
    'dry-run': { type: 'boolean' },
  },
})

const ESRI_URL = values['esri-url']
const WFS_URL = values['wfs-url'] || (ESRI_URL ? null : process.env.MINVU_WFS_URL)
const LAYER = values.layer || process.env.MINVU_SUELO_LAYER
const FIELD_VALOR = values['field-valor']
const FIELD_ZONA = values['field-zona']
const FIELD_COMUNA = values['field-comuna']
const COMUNA_FIJA = values.comuna
const PERIODO = values.periodo
const PAGE_SIZE = Number(values['page-size']) || (ESRI_URL ? 2000 : 5000)
const DRY = values['dry-run'] || !process.env.DATABASE_URL
const RAW_SOURCE = ESRI_URL || LAYER

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

if (!ESRI_URL && !(WFS_URL && LAYER)) {
  fail('Falta la fuente: pasá --esri-url <FeatureServer/MapServer> (vía real MINVU) o --wfs-url + --layer (fallback GeoServer). Ver a0-verify-fuentes.mjs.')
}
if (!FIELD_VALOR) fail('Falta --field-valor (nombre de la propiedad con UF/m² en el GeoJSON).')
if (!PERIODO) fail('Falta --periodo (ej. 2024).')
if (!FIELD_COMUNA && !COMUNA_FIJA) fail('Indica --field-comuna o --comuna (código SII).')

/** Descarga una página de features desde un layer Esri REST (FeatureServer/MapServer), como GeoJSON. */
async function fetchPageEsri(offset) {
  const u = new URL(ESRI_URL.replace(/\/query\/?$/, '') + '/query')
  u.searchParams.set('where', '1=1')
  u.searchParams.set('outFields', '*')
  u.searchParams.set('f', 'geojson')
  u.searchParams.set('resultOffset', String(offset))
  u.searchParams.set('resultRecordCount', String(PAGE_SIZE))
  u.searchParams.set('outSR', '4326')

  const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(`Esri REST HTTP ${res.status} (offset=${offset})`)
  const data = await res.json()
  if (data?.error) throw new Error(`Esri REST error: ${data.error.message ?? JSON.stringify(data.error)}`)
  if (!data || !Array.isArray(data.features)) throw new Error('Respuesta Esri REST sin features[]')
  return data.features
}

/** Descarga una página de features WFS como GeoJSON (fallback GeoServer clásico). */
async function fetchPageWfs(startIndex) {
  const u = new URL(WFS_URL)
  u.searchParams.set('service', 'WFS')
  u.searchParams.set('version', '2.0.0')
  u.searchParams.set('request', 'GetFeature')
  u.searchParams.set('typeName', LAYER)
  u.searchParams.set('typeNames', LAYER)          // algunos GeoServer usan typeNames en 2.0.0
  u.searchParams.set('outputFormat', 'application/json')
  u.searchParams.set('srsName', 'EPSG:4326')
  u.searchParams.set('count', String(PAGE_SIZE))
  u.searchParams.set('startIndex', String(startIndex))

  const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(`WFS HTTP ${res.status} (startIndex=${startIndex})`)
  const data = await res.json()
  if (!data || !Array.isArray(data.features)) throw new Error('Respuesta WFS sin features[]')
  return data.features
}

const fetchPage = ESRI_URL ? fetchPageEsri : fetchPageWfs

function num(v) {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

async function main() {
  console.log(`→ MINVU suelo · fuente=${ESRI_URL ? 'esri' : 'wfs'} · ${RAW_SOURCE} · periodo=${PERIODO}${DRY ? ' · DRY-RUN' : ''}`)

  const client = DRY ? null : new Client({ connectionString: process.env.DATABASE_URL })
  if (client) await client.connect()

  let start = 0
  let total = 0
  let inserted = 0
  let sinValor = 0
  try {
    for (;;) {
      const features = await fetchPage(start)
      if (features.length === 0) break
      total += features.length

      for (const f of features) {
        const props = f.properties || {}
        const valorUfM2 = num(props[FIELD_VALOR])
        if (valorUfM2 == null) { sinValor++; continue }
        const comuna = COMUNA_FIJA || String(props[FIELD_COMUNA] ?? '').trim()
        if (!comuna) { sinValor++; continue }
        const zonaId = FIELD_ZONA ? String(props[FIELD_ZONA] ?? '').trim() || null : null
        const geomJson = f.geometry ? JSON.stringify(f.geometry) : null

        if (DRY) { inserted++; continue }

        await client.query(
          `INSERT INTO mercado_agregado_cl
             (fuente, sii_comuna_code, zona_id, geom, periodo, valor_uf_m2, raw_source)
           VALUES ('minvu_suelo', $1, $2,
                   CASE WHEN $3::text IS NULL THEN NULL
                        ELSE ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)) END,
                   $4, $5, $6)`,
          [comuna, zonaId, geomJson, PERIODO, valorUfM2, RAW_SOURCE]
        )
        inserted++
      }

      if (features.length < PAGE_SIZE) break
      start += PAGE_SIZE
      await SLEEP(1500) // ritmo respetuoso con el servidor público
    }

    console.log(`✓ features=${total} · ${DRY ? 'validadas' : 'insertadas'}=${inserted} · sin valor/comuna=${sinValor}`)
    if (DRY) console.log('  (DRY-RUN: no se escribió en la BD. Define DATABASE_URL y quita --dry-run para persistir.)')
  } finally {
    if (client) await client.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
