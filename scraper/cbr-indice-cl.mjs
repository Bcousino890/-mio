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
// PASO PREVIO (confirmar el contrato del portal, SIN terminal): correr el modo
//   node scraper/cbr-indice-cl.mjs --probe [--probe-url "https://<portal>"]
// (workflow verify-mercado-fuentes.yml, modo cbr_probe). Baja el HTML del portal
// y extrae formularios (action/method/inputs), endpoints XHR del JS, iframes y
// links de índice — lo que un humano miraría en DevTools. Con eso se fija
// --search-url y se ajusta el parser (parseIndice) a la forma real.
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
    probe: { type: 'boolean' },
    'probe-url': { type: 'string' },
  },
})

const SEARCH_URL = values['search-url']
const COMUNA = values.comuna
const CBR = values.cbr || null
const ANIO = values.anio ? Number(values.anio) : null
const DRY = values['dry-run'] || !process.env.DATABASE_URL

function fail(m) { console.error(`✗ ${m}`); process.exit(1) }

/**
 * ── Modo --probe: descubrir el contrato del portal SIN navegador ─────────────
 * Reemplaza el "paso previo" manual: baja el HTML del portal y extrae lo que un
 * humano buscaría en DevTools para fijar --search-url sin adivinar:
 *   - <form>: action + method + nombres de inputs/selects (contrato clásico)
 *   - endpoints XHR citados en el JS inline (fetch/axios/$.ajax, rutas "/api/…")
 *   - iframes (muchos CBR embeben la app de búsqueda por jurisdicción)
 *   - links con pinta de índice/propiedad/consulta
 */
async function probePortal(url) {
  console.log(`→ Sonda del portal CBR: ${url}\n`)
  let res
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(30000) })
  } catch (err) {
    console.log(`✗ No alcanzable: ${err.message}`)
    return
  }
  const html = await res.text()
  console.log(`HTTP ${res.status} · ${res.headers.get('content-type') || '?'} · ${html.length} bytes${res.url !== url ? ` · redirigida a ${res.url}` : ''}`)
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
  if (title) console.log(`Título: ${title}`)

  // Formularios: el contrato de búsqueda clásico.
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? []
  console.log(`\nFormularios (${forms.length}):`)
  for (const f of forms.slice(0, 6)) {
    const action = f.match(/\baction\s*=\s*["']([^"']*)["']/i)?.[1] ?? '(sin action)'
    const method = f.match(/\bmethod\s*=\s*["']([^"']*)["']/i)?.[1] ?? 'GET'
    const inputs = [...f.matchAll(/<(?:input|select|textarea)\b[^>]*\bname\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
    console.log(`  • ${method.toUpperCase()} ${action}`)
    if (inputs.length) console.log(`    campos: ${inputs.join(', ')}`)
  }

  // Endpoints XHR en el JS (lo que DevTools mostraría en Network).
  // Lección del run 2026-07-13: el dominio del CDN contiene "conservador", así
  // que filtrar por el TEXTO completo de la URL matchea todos los assets. Se
  // filtran extensiones estáticas y se evalúa el patrón API solo sobre el PATH.
  const ASSET_RE = /\.(png|jpe?g|svg|gif|ico|css|woff2?|ttf|eot|map|webp)([?#]|$)/i
  const pathOf = (u) => u.replace(/^https?:\/\/[^/]+/, '')
  const looksApi = (u) => /api|buscar|consulta|search|indice/i.test(pathOf(u))
  const extractEndpoints = (code, into) => {
    for (const m of code.matchAll(/(?:fetch|axios\s*\.\s*(?:get|post)|\$\.(?:ajax|get|post))\s*\(\s*["'`]([^"'`]+)["'`]/gi)) {
      if (!ASSET_RE.test(m[1])) into.add(m[1])
    }
    for (const m of code.matchAll(/["'`](\/[^"'`\s]{2,120}?(?:api|buscar|consulta|indice|search)[^"'`\s]{0,120}?)["'`]/gi)) {
      if (!ASSET_RE.test(m[1])) into.add(m[1])
    }
    for (const m of code.matchAll(/https?:\/\/[^"'`\s\\)]{8,160}/g)) {
      if (!ASSET_RE.test(m[0]) && looksApi(m[0])) into.add(m[0])
    }
  }
  const xhr = new Set()
  extractEndpoints(html, xhr)
  console.log(`\nEndpoints XHR/API citados en el JS inline (${xhr.size}):`)
  for (const e of [...xhr].slice(0, 25)) console.log(`  · ${e}`)

  // SPA (run 2026-07-13: conservadoresdigitales.cl trae 0 forms y solo assets
  // inline — 264 KB de HTML de una app JS): los endpoints viven en los bundles
  // externos (app.min.*.js). Bajar hasta 5 <script src> y buscar dentro, como
  // haría DevTools en la pestaña Sources.
  const apiLike = [...xhr].filter(looksApi)
  if (forms.length === 0 && apiLike.length === 0) {
    const srcs = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
      .map((m) => { try { return new URL(m[1], res.url).toString() } catch { return null } })
      .filter(Boolean)
    console.log(`\nSPA detectada (sin forms ni endpoints inline). Bundles JS (${srcs.length}); inspecciono hasta 5:`)
    for (const src of srcs.slice(0, 5)) {
      try {
        const jsRes = await fetch(src, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })
        if (!jsRes.ok) { console.log(`  ✗ [${jsRes.status}] ${src}`); continue }
        const code = (await jsRes.text()).slice(0, 2_000_000)
        const found = new Set()
        extractEndpoints(code, found)
        console.log(`  • ${src} (${code.length} bytes) → ${found.size} endpoint(s)`)
        for (const e of [...found].slice(0, 20)) console.log(`      · ${e}`)
      } catch (err) {
        console.log(`  ✗ ${src}: ${err.message}`)
      }
    }
  }

  // Iframes: apps embebidas por jurisdicción.
  const iframes = [...html.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1])
  if (iframes.length) {
    console.log(`\nIframes (${iframes.length}) — sondear también estas URLs:`)
    for (const i of iframes.slice(0, 10)) console.log(`  · ${i}`)
  }

  // Links temáticos.
  const links = new Map()
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (/indice|propiedad|conservador|b[uú]squeda|consulta/i.test(`${m[1]} ${text}`)) {
      try { links.set(new URL(m[1], res.url).toString(), text) } catch { /* href raro */ }
    }
  }
  console.log(`\nLinks de índice/consulta (${links.size}):`)
  for (const [href, text] of [...links].slice(0, 25)) console.log(`  · ${text || '(sin texto)'} → ${href}`)

  console.log(`\nSiguiente paso: si arriba hay un endpoint JSON claro, fijar --search-url y ajustar`)
  console.log(`parseIndice; si es un form HTML o iframe, relanzar la sonda con --probe-url <esa URL>.`)
}

if (values.probe) {
  await probePortal(values['probe-url'] || 'https://conservadoresdigitales.cl')
  process.exit(0)
}

if (!SEARCH_URL) fail('Falta --search-url. Confirma el endpoint del Índice de Propiedad (correr antes --probe, ver cabecera).')
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
  // pg se importa solo si se va a escribir: --probe y --dry-run no lo necesitan.
  const client = DRY ? null : new (await import('pg')).default.Client({ connectionString: process.env.DATABASE_URL })
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
