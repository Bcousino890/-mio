#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ingest-minvu-suelo.mjs — ingesta el valor de suelo (UF/m² por zona) del
// Observatorio del Mercado de Suelo de MINVU (ide.minvu.cl, open data OGC) en
// `mercado_agregado_cl` (migración 0057, fuente='minvu_suelo').
//
// MINVU publica indicadores de valor de suelo derivados de transacciones no
// agrícolas del SII. Es la señal pública de "mercado realizado" (nivel suelo/zona)
// que calibra el AVM — ver web/app/api/chile/avm/route.ts y
// docs/CBR-TRANSACCIONES-REPOS-2026.md. NO son precios de cierre por predio.
//
// PASO A0 (verificar ANTES de correr en serio, donde la red a ide.minvu.cl esté
// abierta): lista las capas y sus campos con GetCapabilities y luego apunta los
// flags --layer / --field-* a la capa real de valor de suelo:
//
//   curl "https://ide.minvu.cl/geoserver/wfs?service=WFS&version=2.0.0&request=GetCapabilities"
//   curl "https://ide.minvu.cl/geoserver/wfs?service=WFS&version=2.0.0&request=DescribeFeatureType&typeName=<capa>"
//
// USO:
//   node scraper/ingest-minvu-suelo.mjs \
//     --wfs-url https://ide.minvu.cl/geoserver/wfs \
//     --layer <capa_valor_suelo> \
//     --field-valor <prop_uf_m2> [--field-zona <prop_zona>] \
//     [--field-comuna <prop_cod_comuna> | --comuna 13101] \
//     --periodo 2024 [--dry-run]
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
    'wfs-url': { type: 'string' },
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

const WFS_URL = values['wfs-url'] || process.env.MINVU_WFS_URL
const LAYER = values.layer || process.env.MINVU_SUELO_LAYER
const FIELD_VALOR = values['field-valor']
const FIELD_ZONA = values['field-zona']
const FIELD_COMUNA = values['field-comuna']
const COMUNA_FIJA = values.comuna
const PERIODO = values.periodo
const PAGE_SIZE = Number(values['page-size']) || 5000
const DRY = values['dry-run'] || !process.env.DATABASE_URL

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

if (!WFS_URL) fail('Falta --wfs-url (o MINVU_WFS_URL). Ver el bloque A0 de la cabecera.')
if (!LAYER) fail('Falta --layer (o MINVU_SUELO_LAYER).')
if (!FIELD_VALOR) fail('Falta --field-valor (nombre de la propiedad con UF/m² en el GeoJSON).')
if (!PERIODO) fail('Falta --periodo (ej. 2024).')
if (!FIELD_COMUNA && !COMUNA_FIJA) fail('Indica --field-comuna o --comuna (código SII).')

/** Descarga una página de features WFS como GeoJSON. */
async function fetchPage(startIndex) {
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

function num(v) {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

async function main() {
  console.log(`→ MINVU suelo · capa=${LAYER} · periodo=${PERIODO}${DRY ? ' · DRY-RUN' : ''}`)

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
          [comuna, zonaId, geomJson, PERIODO, valorUfM2, LAYER]
        )
        inserted++
      }

      if (features.length < PAGE_SIZE) break
      start += PAGE_SIZE
      await SLEEP(1500) // ritmo respetuoso con el servidor OGC público
    }

    console.log(`✓ features=${total} · ${DRY ? 'validadas' : 'insertadas'}=${inserted} · sin valor/comuna=${sinValor}`)
    if (DRY) console.log('  (DRY-RUN: no se escribió en la BD. Define DATABASE_URL y quita --dry-run para persistir.)')
  } finally {
    if (client) await client.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
