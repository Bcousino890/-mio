#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ingest-cadastre-cl-ide.mjs — ingesta de geometría real de parcelas (capa
// "Predios" de MINVU, vía IDE Chile / Geoportal.cl / SNIT) para comunas con
// roles SII ya confirmados en `sii_roles_cl`.
//
// DEPRIORIZADO: el endpoint WFS nunca se confirmó (ver estado más abajo) y
// dejó de ser la vía activa para poblar `cadastre_parcels_cl`. La vía actual
// es ingest-cadastre-cl-geocode.mjs (geocodifica la dirección del rol vía
// Nominatim, sin depender de IDE Chile). Este script se deja tal cual por si
// el endpoint WFS llega a confirmarse más adelante — no se ejecuta de forma
// rutinaria.
//
// CONSTRAINT LEGAL NO NEGOCIABLE (ver banner de scraper/lib/cadastre-cl.mjs y
// db/migrations/0020_cadastre_chile.sql líneas 1-26): este script NUNCA debe
// hacer requests contra sii.cl, mapasui.cl, zeus.sii.cl, ni ningún (sub)dominio
// del SII. La ÚNICA fuente de geometría es IDE Chile / Geoportal.cl (SNIT),
// vía servicios WMS/WFS estándar OGC (capa "Predios" del MINVU).
//
// ESTADO DEL ENDPOINT WFS: NO CONFIRMADO POR SPIKE DE RED EN VIVO.
// ──────────────────────────────────────────────────────────────────────────
// El equipo (docs/RC-CHILE-INVESTIGACION.md §4) identificó la FUENTE correcta
// (IDE Chile/Geoportal, capa "Predios" de MINVU, OGC WMS/WFS/WCS estándar,
// cobertura ~170/346 comunas) pero dejó pendiente confirmar con un spike real
// de red: (a) la URL exacta del servicio WFS, (b) el typeName/workspace exacto
// de la capa, (c) el campo de filtro por comuna (nombre vs. código CUT), (d)
// el SRID nativo. El entorno donde se escribió este script tenía la red
// saliente bloqueada hacia geoportal.cl / ide.cl / ide.minvu.cl (egress
// allowlist del sandbox + fallo general de la herramienta de fetch web), así
// que NO fue posible explorar GetCapabilities en vivo — ver reporte de la
// tarea que generó este archivo.
//
// Por eso este script NO hardcodea un typeName ni una URL inventados: en su
// lugar, intenta DESCUBRIR la capa en tiempo de ejecución contra una lista de
// endpoints GeoServer candidatos (todos bajo geoportal.cl, que es el dominio
// confirmado por búsqueda — ver WFS_BASE_CANDIDATES abajo), y solo procede si
// encuentra una capa cuyo nombre matchea /predios/i en GetCapabilities. Si no
// encuentra nada (red bloqueada, o el nombre real de la capa no matchea ese
// patrón), el script TERMINA con un mensaje de error explícito — nunca
// inventa ni rellena con geometría aproximada (eso violaría source='ide_chile'
// y el principio rector del proyecto de "nunca inventar geometría").
//
// USO:
//   IDE_CHILE_WFS_BASE=https://www.geoportal.cl/geoserver \
//   IDE_CHILE_WFS_LAYER=minvu:Predios \
//   IDE_CHILE_COMUNA_FIELD=NOM_COMUNA \
//   DATABASE_URL=postgres://casafari:casafari@localhost:5433/casafari \
//   node scraper/ingest-cadastre-cl-ide.mjs
//
// Si IDE_CHILE_WFS_BASE / IDE_CHILE_WFS_LAYER no se definen, el script intenta
// autodescubrir contra WFS_BASE_CANDIDATES antes de rendirse.
// ─────────────────────────────────────────────────────────────────────────────
import pg from 'pg'

const { Client } = pg

// ─── Comunas objetivo (ya tienen roles SII confirmados en sii_roles_cl) ─────
const TARGET_COMUNAS = [
  { name: 'Vitacura', sii_comuna_code: '15160' },
  { name: 'Las Condes', sii_comuna_code: '15108' },
  { name: 'Lo Barnechea', sii_comuna_code: '15161' },
  { name: 'Colina', sii_comuna_code: '14201' },
]

// Candidatos razonables de base de GeoServer bajo el dominio confirmado
// (geoportal.cl) — NO confirmados por GetCapabilities real, ver banner arriba.
const WFS_BASE_CANDIDATES = [
  process.env.IDE_CHILE_WFS_BASE,
  'https://www.geoportal.cl/geoserver',
  'https://geoportal.cl/geoserver',
].filter(Boolean)

// Nombres de capa candidatos a buscar dentro de GetCapabilities (case-insensitive,
// admite con o sin prefijo de workspace, ej. "minvu:Predios").
const LAYER_NAME_PATTERN = /predios/i

// Campos candidatos para filtrar por comuna server-side vía CQL_FILTER —
// probados en orden hasta que uno no devuelva error 4xx del WFS.
const COMUNA_FIELD_CANDIDATES = process.env.IDE_CHILE_COMUNA_FIELD
  ? [process.env.IDE_CHILE_COMUNA_FIELD]
  : ['NOM_COMUNA', 'COMUNA', 'Comuna', 'nom_comuna', 'cut_comuna', 'CUT_COM', 'CUT_COMUNA']

const RATE_LIMIT_MS = Number(process.env.IDE_CHILE_RATE_LIMIT_MS || 1500)
const FETCH_TIMEOUT_MS = 30_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  const body = await res.text()
  return { ok: res.ok, status: res.status, body }
}

/**
 * Intenta encontrar (wfsBase, layerName) válidos probando GetCapabilities
 * contra cada candidato de WFS_BASE_CANDIDATES, hasta encontrar una capa cuyo
 * nombre matchee LAYER_NAME_PATTERN.
 */
async function discoverPrediosLayer() {
  // Si el caller ya fijó explícitamente la capa vía env vars, no autodescubrir.
  if (process.env.IDE_CHILE_WFS_BASE && process.env.IDE_CHILE_WFS_LAYER) {
    return { wfsBase: process.env.IDE_CHILE_WFS_BASE, layerName: process.env.IDE_CHILE_WFS_LAYER }
  }

  for (const base of WFS_BASE_CANDIDATES) {
    const capUrl = `${base}/wfs?service=WFS&version=2.0.0&request=GetCapabilities`
    console.log(`[discover] probando GetCapabilities: ${capUrl}`)
    let res
    try {
      res = await fetchText(capUrl)
    } catch (err) {
      console.warn(`[discover] fallo de red contra ${base}: ${err.message}`)
      continue
    }
    if (!res.ok) {
      console.warn(`[discover] ${base} respondió HTTP ${res.status}`)
      continue
    }
    // Extracción simple de <Name>...</Name> dentro de <FeatureType> sin parser XML completo
    // (suficiente para descubrimiento; no se usa para parsear geometría real).
    const names = [...res.body.matchAll(/<(?:\w+:)?Name>([^<]+)<\/(?:\w+:)?Name>/g)].map((m) => m[1])
    const match = names.find((n) => LAYER_NAME_PATTERN.test(n))
    if (match) {
      console.log(`[discover] capa encontrada: '${match}' en ${base}`)
      return { wfsBase: base, layerName: match }
    }
    console.warn(`[discover] ${base} no tiene ninguna capa que matchee /predios/i (${names.length} capas listadas)`)
  }
  return null
}

/**
 * Intenta GetFeature con CQL_FILTER por comuna, probando cada campo candidato
 * hasta que uno funcione (HTTP 200 + GeoJSON válido con features, o al menos
 * sin error de "atributo desconocido").
 */
async function fetchFeaturesForComuna({ wfsBase, layerName, comunaName }) {
  for (const field of COMUNA_FIELD_CANDIDATES) {
    // ILIKE para tolerar mayúsculas/tildes inconsistentes en el dato de origen.
    const cql = `${field} ILIKE '${comunaName.replace(/'/g, "''")}'`
    const url =
      `${wfsBase}/wfs?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeName=${encodeURIComponent(layerName)}&outputFormat=application/json` +
      `&cql_filter=${encodeURIComponent(cql)}`

    console.log(`[fetch] comuna=${comunaName} probando campo='${field}'`)
    let res
    try {
      res = await fetchText(url)
    } catch (err) {
      console.warn(`[fetch] error de red: ${err.message}`)
      await sleep(RATE_LIMIT_MS)
      continue
    }
    await sleep(RATE_LIMIT_MS)

    if (!res.ok) {
      console.warn(`[fetch] campo '${field}' -> HTTP ${res.status}, probando siguiente candidato`)
      continue
    }
    let geojson
    try {
      geojson = JSON.parse(res.body)
    } catch {
      console.warn(`[fetch] campo '${field}' -> respuesta no es JSON válido (¿XML de excepción WFS?), probando siguiente candidato`)
      continue
    }
    if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
      console.log(`[fetch] campo '${field}' funcionó: ${geojson.features.length} features para ${comunaName}`)
      return { features: geojson.features, fieldUsed: field }
    }
  }
  return { features: [], fieldUsed: null }
}

/**
 * Convierte una geometría GeoJSON Polygon/MultiPolygon a MultiPolygon vía
 * SQL (ST_Multi) — se hace en SQL para no reimplementar lógica de geometría
 * en JS; aquí solo se decide el tipo esperado para validación temprana.
 */
function isPolygonal(geometry) {
  return geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')
}

function isPoint(geometry) {
  return geometry && geometry.type === 'Point'
}

async function resolveComunaIds(client) {
  const map = new Map()
  for (const { name, sii_comuna_code } of TARGET_COMUNAS) {
    const res = await client.query(
      `SELECT id FROM chile_comunas WHERE name = $1 OR sii_comuna_code = $2 LIMIT 1`,
      [name, sii_comuna_code]
    )
    if (res.rows[0]?.id) {
      map.set(name, res.rows[0].id)
    } else {
      console.error(`[db] comuna NO encontrada en chile_comunas: ${name} (sii_comuna_code=${sii_comuna_code})`)
    }
  }
  return map
}

async function insertFeature(client, { comunaId, feature }) {
  const geometry = feature.geometry

  // Si la capa no trae celda/polígono para este predio (algunas comunas en
  // IDE Chile solo expone el punto), no descartamos la feature — la dejamos
  // como punto (geom NULL, solo centroid) para que al menos se vea algo en
  // el mapa en vez de nada. Sigue siendo geometría real de la fuente, no
  // inventada: no viola el principio de "nunca inventar geometría".
  let geomExpr, centroidExpr
  if (isPolygonal(geometry)) {
    geomExpr = 'ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))'
    centroidExpr = 'ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))'
  } else if (isPoint(geometry)) {
    geomExpr = 'NULL'
    centroidExpr = 'ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)'
  } else {
    return { inserted: false, reason: 'geometria no poligonal ni puntual (sin celda ni punto utilizable)' }
  }

  const rol =
    feature.properties?.rol ??
    feature.properties?.ROL ??
    feature.properties?.Rol ??
    null

  try {
    const result = await client.query(
      `
      INSERT INTO cadastre_parcels_cl (comuna_id, rol, source, geom, centroid, raw_attrs)
      VALUES ($1, $2, 'ide_chile', ${geomExpr}, ${centroidExpr}, $4::jsonb)
      RETURNING id
      `,
      [comunaId, rol, JSON.stringify(geometry), JSON.stringify(feature.properties ?? {})]
    )
    return { inserted: result.rows.length > 0 }
  } catch (err) {
    return { inserted: false, reason: err.message }
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('[main] DATABASE_URL no configurada — abortando')
    process.exit(1)
  }

  console.log('[main] descubriendo capa "Predios" en GeoServer de IDE Chile/Geoportal...')
  const discovered = await discoverPrediosLayer()
  if (!discovered) {
    console.error(
      '[main] NO se pudo descubrir/confirmar el servicio WFS de la capa "Predios". ' +
      'Esto puede deberse a: (a) red saliente bloqueada hacia geoportal.cl/ide.cl desde este ' +
      'entorno (confirmado durante el desarrollo de este script — ver banner de cabecera), ' +
      '(b) el endpoint real no está bajo ninguno de WFS_BASE_CANDIDATES, o (c) el nombre real ' +
      'de la capa no matchea /predios/i. NO se insertó ninguna fila — no se inventa geometría. ' +
      'Define IDE_CHILE_WFS_BASE e IDE_CHILE_WFS_LAYER explícitamente si ya conoces el endpoint ' +
      '(por ejemplo, tras inspeccionar GetCapabilities manualmente desde un entorno con acceso de red).'
    )
    process.exit(2)
  }

  const { wfsBase, layerName } = discovered
  console.log(`[main] usando wfsBase=${wfsBase} layerName=${layerName}`)

  const client = new Client({ connectionString: dbUrl })
  await client.connect()

  const summary = []
  try {
    const comunaIds = await resolveComunaIds(client)

    for (const { name } of TARGET_COMUNAS) {
      const comunaId = comunaIds.get(name)
      if (!comunaId) {
        summary.push({ comuna: name, status: 'sin comuna_id en chile_comunas', inserted: 0 })
        continue
      }

      const { features, fieldUsed } = await fetchFeaturesForComuna({ wfsBase, layerName, comunaName: name })
      if (features.length === 0) {
        summary.push({ comuna: name, status: 'sin cobertura en la capa Predios (0 features)', inserted: 0 })
        continue
      }

      let inserted = 0
      let skipped = 0
      for (const feature of features) {
        const { inserted: ok, reason } = await insertFeature(client, { comunaId, feature })
        if (ok) inserted++
        else {
          skipped++
          if (reason) console.warn(`[insert] comuna=${name} feature omitida: ${reason}`)
        }
      }
      summary.push({ comuna: name, status: `ok (campo filtro: ${fieldUsed})`, inserted, skipped, total: features.length })
    }
  } finally {
    await client.end()
  }

  console.log('\n[main] resumen de ingesta:')
  for (const row of summary) {
    console.log(`  - ${row.comuna}: ${JSON.stringify(row)}`)
  }
}

main().catch((err) => {
  console.error('[main] error fatal:', err)
  process.exit(1)
})
