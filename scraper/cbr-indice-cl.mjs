#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// cbr-indice-cl.mjs — Índice de Propiedad público del Conservador de Bienes
// Raíces → `cbr_indice_cl` (migración 0059). Devuelve FOJA / NÚMERO / AÑO de las
// inscripciones (y a veces fecha/tipo de acto). NO trae MONTO — el precio de
// cierre no es público (ver docs/CBR-TRANSACCIONES-REPOS-2026.md).
//
// ⚠️ PROCEDENCIA FRÁGIL (mismo criterio que scraper/sii-scraper, ver
// docs/SII-MAPASUI-SCRAPER.md): el Índice de Propiedad es público y SIN login,
// pero cada Conservador expone su propio portal (conservadoresdigitales.cl y
// sitios por jurisdicción), muchos con captcha o límites. Esto es best-effort:
// se busca por NOMBRE del titular (así funciona el índice, no por rol) y la
// vinculación a un rol es posterior. Tabla SEPARADA de datos de precio; no
// redistribuir.
//
// PASO PREVIO (confirmar el contrato del portal, donde la red esté abierta):
// abrir el Índice de Propiedad de la comuna objetivo en conservadoresdigitales.cl,
// inspeccionar la petición de búsqueda (endpoint, parámetros, forma de la
// respuesta) y ajustar --search-url y el parser (parseIndice) a esa forma real.
//
// USO:
//   node scraper/cbr-indice-cl.mjs \
//     --search-url "https://<portal-cbr>/indice/buscar" \
//     --comuna 13101 --cbr "CBR Santiago" \
//     --names-file nombres.txt [--anio 2024] [--dry-run]
//
// `nombres.txt` = un nombre de titular por línea. Sin DATABASE_URL o con
// --dry-run: consulta y muestra, sin escribir.
// ─────────────────────────────────────────────────────────────────────────────
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import pg from 'pg'

const { Client } = pg
const UA = 'CasafariMIO/1.0 (+consulta Índice de Propiedad público CBR)'
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms))

const { values } = parseArgs({
  options: {
    'search-url': { type: 'string' },
    comuna: { type: 'string' },
    cbr: { type: 'string' },
    'names-file': { type: 'string' },
    anio: { type: 'string' },
    'dry-run': { type: 'boolean' },
  },
})

const SEARCH_URL = values['search-url']
const COMUNA = values.comuna
const CBR = values.cbr || null
const ANIO = values.anio ? Number(values.anio) : null
const DRY = values['dry-run'] || !process.env.DATABASE_URL

function fail(m) { console.error(`✗ ${m}`); process.exit(1) }
if (!SEARCH_URL) fail('Falta --search-url. Confirma el endpoint del Índice de Propiedad (ver cabecera).')
if (!COMUNA) fail('Falta --comuna (código SII).')
if (!values['names-file']) fail('Falta --names-file (un nombre de titular por línea).')

/**
 * Normaliza la respuesta del portal a filas {nombre_titular, foja, numero, anio,
 * fecha_inscripcion, tipo_acto}. Los portales devuelven formas distintas; esta
 * función cubre el caso JSON común y hay que ajustarla al portal real (ver
 * cabecera). Nunca lanza: devuelve [] ante formatos inesperados.
 */
function parseIndice(payload, nombre) {
  try {
    const arr = Array.isArray(payload) ? payload
      : Array.isArray(payload?.data) ? payload.data
      : Array.isArray(payload?.resultados) ? payload.resultados
      : []
    return arr.map((r) => ({
      nombre_titular: r.nombre ?? r.titular ?? nombre,
      foja: r.foja != null ? String(r.foja) : null,
      numero: r.numero != null ? String(r.numero) : (r.numero_inscripcion != null ? String(r.numero_inscripcion) : null),
      anio: Number(r.anio ?? r.year ?? r['año']) || null,
      fecha_inscripcion: r.fecha ?? r.fecha_inscripcion ?? null,
      tipo_acto: r.tipo ?? r.tipo_acto ?? r.acto ?? null,
    })).filter((r) => r.foja || r.numero)
  } catch {
    return []
  }
}

async function consultar(nombre) {
  const u = new URL(SEARCH_URL)
  u.searchParams.set('nombre', nombre)
  if (ANIO) u.searchParams.set('anio', String(ANIO))
  const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const ct = res.headers.get('content-type') || ''
  const payload = ct.includes('json') ? await res.json() : await res.text()
  if (typeof payload === 'string') {
    console.warn(`  ! respuesta no-JSON para "${nombre}" — ajustar parseIndice al HTML del portal`)
    return []
  }
  return parseIndice(payload, nombre)
}

async function main() {
  const names = (await readFile(values['names-file'], 'utf8'))
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  if (names.length === 0) fail('El archivo de nombres está vacío.')

  console.log(`→ CBR índice · comuna=${COMUNA} · nombres=${names.length}${DRY ? ' · DRY-RUN' : ''}`)
  const client = DRY ? null : new Client({ connectionString: process.env.DATABASE_URL })
  if (client) await client.connect()

  let filas = 0
  try {
    for (const nombre of names) {
      let rows = []
      try { rows = await consultar(nombre) }
      catch (e) { console.warn(`  ! "${nombre}": ${e.message}`); await SLEEP(2000); continue }

      for (const r of rows) {
        filas++
        if (DRY) continue
        await client.query(
          `INSERT INTO cbr_indice_cl
             (sii_comuna_code, nombre_titular, foja, numero, anio, fecha_inscripcion, tipo_acto, cbr_nombre, raw_source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (cbr_nombre, foja, numero, anio)
             WHERE foja IS NOT NULL AND numero IS NOT NULL AND anio IS NOT NULL
           DO NOTHING`,
          [COMUNA, r.nombre_titular, r.foja, r.numero, r.anio, r.fecha_inscripcion, r.tipo_acto, CBR, SEARCH_URL]
        )
      }
      await SLEEP(2000) // ritmo respetuoso; subir el delay si el portal limita
    }
    console.log(`✓ inscripciones ${DRY ? 'encontradas' : 'insertadas'}=${filas}`)
    if (DRY) console.log('  (DRY-RUN: no se escribió. Confirma el contrato del portal antes de persistir.)')
  } finally {
    if (client) await client.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
