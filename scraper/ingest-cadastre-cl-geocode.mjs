#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ingest-cadastre-cl-geocode.mjs — geocodifica la dirección de cada rol SII ya
// cargado en `sii_roles_cl` (vía Nominatim/OpenStreetMap, scraper/lib/geocode-cl.mjs)
// e inserta un punto en `cadastre_parcels_cl` para que el mapa tenga ALGO que
// mostrar/clickear por rol, sin depender de IDE Chile/Geoportal.cl.
//
// Por qué este script en vez de ingest-cadastre-cl-ide.mjs: ese script intenta
// obtener el polígono REAL de cada predio desde el WFS "Predios" de IDE Chile,
// pero su endpoint nunca se confirmó (red bloqueada durante el desarrollo) y
// quedó como bloqueador permanente. Decisión: dejar de depender de esa fuente
// para tener algo visible en el mapa — un punto geocodificado por dirección no
// es la celda catastral exacta, pero es un punto REAL (no inventado: viene de
// geocodificar la dirección real del rol contra OpenStreetMap), suficiente
// para ubicar y clickear el predio en el mapa y ver su Rol/info.
//
// source='estimated' (no 'ide_chile'): la migración 0020 documenta 'estimated'
// como "geometría aproximada/derivada (ej. buffer sobre centroide)" — un punto
// geocodificado por dirección encaja en esa definición.
//
// Idempotente: no vuelve a geocodificar un rol que ya tiene fila en
// cadastre_parcels_cl para esa comuna.
//
// USO:
//   DATABASE_URL=postgres://casafari:casafari@localhost:5433/casafari \
//   node scraper/ingest-cadastre-cl-geocode.mjs
// ─────────────────────────────────────────────────────────────────────────────
import pg from 'pg'
import { geocodeAddressCl } from './lib/geocode-cl.mjs'

const { Client } = pg

const TARGET_COMUNAS = [
  { name: 'Vitacura', sii_comuna_code: '15160' },
  { name: 'Las Condes', sii_comuna_code: '15108' },
  { name: 'Lo Barnechea', sii_comuna_code: '15161' },
  { name: 'Colina', sii_comuna_code: '14201' },
]

const LIMIT_PER_COMUNA = Number(process.env.GEOCODE_CL_LIMIT_PER_COMUNA || 500)

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

async function fetchPendingRoles(client, { sii_comuna_code, comunaId }) {
  const res = await client.query(
    `
    SELECT r.rol, r.direccion
    FROM sii_roles_cl r
    WHERE r.sii_comuna_code = $1
      AND r.direccion IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM cadastre_parcels_cl cp
        WHERE cp.comuna_id = $2 AND cp.rol = r.rol
      )
    LIMIT $3
    `,
    [sii_comuna_code, comunaId, LIMIT_PER_COMUNA]
  )
  return res.rows
}

async function insertGeocodedPoint(client, { comunaId, rol, direccion, point }) {
  try {
    const result = await client.query(
      `
      INSERT INTO cadastre_parcels_cl (comuna_id, rol, source, geom, centroid, raw_attrs)
      VALUES ($1, $2, 'estimated', NULL, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5::jsonb)
      RETURNING id
      `,
      [comunaId, rol, point.lng, point.lat, JSON.stringify({ direccion, geocoder: 'nominatim' })]
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

  const client = new Client({ connectionString: dbUrl })
  await client.connect()

  const summary = []
  try {
    const comunaIds = await resolveComunaIds(client)

    for (const { name, sii_comuna_code } of TARGET_COMUNAS) {
      const comunaId = comunaIds.get(name)
      if (!comunaId) {
        summary.push({ comuna: name, status: 'sin comuna_id en chile_comunas', geocoded: 0 })
        continue
      }

      const pending = await fetchPendingRoles(client, { sii_comuna_code, comunaId })
      if (pending.length === 0) {
        summary.push({ comuna: name, status: 'sin roles pendientes de geocodificar', geocoded: 0 })
        continue
      }

      let geocoded = 0
      let noMatch = 0
      let failed = 0
      for (const { rol, direccion } of pending) {
        const point = await geocodeAddressCl({ address: direccion, comuna: name })
        if (!point) {
          noMatch++
          continue
        }
        const { inserted, reason } = await insertGeocodedPoint(client, { comunaId, rol, direccion, point })
        if (inserted) geocoded++
        else {
          failed++
          if (reason) console.warn(`[insert] comuna=${name} rol=${rol} omitido: ${reason}`)
        }
      }
      summary.push({ comuna: name, status: 'ok', pending: pending.length, geocoded, noMatch, failed })
    }
  } finally {
    await client.end()
  }

  console.log('\n[main] resumen de geocodificación:')
  for (const row of summary) {
    console.log(`  - ${row.comuna}: ${JSON.stringify(row)}`)
  }
}

main().catch((err) => {
  console.error('[main] error fatal:', err)
  process.exit(1)
})
