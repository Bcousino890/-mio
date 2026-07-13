#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// a0-verify-fuentes.mjs — Paso A0 (Fase 2): verifica las fuentes públicas de
// mercado ANTES de cargar a escala. Correr donde la red a ide.minvu.cl esté
// abierta (VPS o local del usuario; el entorno de build de Claude bloquea ese
// host con 403).
//
// DESCUBRIMIENTO (primer run real, 2026-07-12): ide.minvu.cl NO es un GeoServer
// WFS clásico — es un portal Esri ArcGIS Hub ("Geoportal Open Data Minvu"). El
// intento original de GetCapabilities devolvió HTML, no XML. Por eso el modo
// por defecto ahora es la búsqueda de datasets de ArcGIS Hub (--search), y el
// describe de campos usa la REST API nativa de Esri (--esri-describe) en vez
// de DescribeFeatureType. Se conservan --wfs / --describe como fallback
// explícito por si otra fuente (ej. geoportal.cl) sí es GeoServer clásico.
//
// Qué hace:
//   1. --search <término>: busca datasets en el Hub (ArcGIS Hub Search API v3)
//      → título, id, tipo, y la URL del servicio REST (FeatureServer/MapServer)
//      si el dataset es un servicio consultable.
//   2. --esri-describe <url_del_servicio>: `<url>?f=json` → lista los campos de
//      la capa, para fijar --field-valor / --field-zona / --field-comuna.
//   3. --auto-find-valor: inspecciona TODOS los datasets del catálogo para encontrar
//      cuál tiene campos de valor de suelo (cuando la búsqueda por término falla).
//   4. --wfs / --describe <capa>: fallback GeoServer WFS clásico (otros portales).
//
// USO:
//   node scraper/a0-verify-fuentes.mjs                          # busca "valor de suelo"
//   node scraper/a0-verify-fuentes.mjs --search "observatorio mercado de suelo"
//   node scraper/a0-verify-fuentes.mjs --auto-find-valor        # inspecciona todos los datasets
//   node scraper/a0-verify-fuentes.mjs --esri-describe "https://.../FeatureServer/0"
//   node scraper/a0-verify-fuentes.mjs --wfs --wfs-url https://otro/geoserver/wfs
//
// Salida: imprime los comandos ingest-minvu-suelo.mjs sugeridos con los flags ya
// rellenados. NO escribe en la BD.
// ─────────────────────────────────────────────────────────────────────────────
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    'hub-url': { type: 'string' },
    search: { type: 'string' },
    'esri-describe': { type: 'string' },
    'auto-find-valor': { type: 'boolean' },
    'wfs-url': { type: 'string' },
    describe: { type: 'string' },
    wfs: { type: 'boolean' },
  },
})

const HUB = values['hub-url'] || process.env.MINVU_HUB_URL || 'https://ide.minvu.cl'
const WFS = values['wfs-url'] || process.env.MINVU_WFS_URL || 'https://ide.minvu.cl/geoserver/wfs'
const UA = 'CasafariMIO/1.0 (+verificacion A0 open data MINVU)'
const DEFAULT_TERM = 'valor de suelo'

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,application/xml,text/xml,*/*' }, signal: AbortSignal.timeout(60000) })
  const text = await res.text()
  const contentType = res.headers.get('content-type') || '(sin content-type)'
  return { ok: res.ok, status: res.status, contentType, text }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * fetch→JSON que NUNCA lanza: un timeout o error de red en UNA capa no debe
 * abortar el crawl completo (lección del primer run de --auto-find-valor, que
 * murió entero por un solo AbortSignal.timeout a los ~24 servicios).
 */
async function getJsonSafe(url, timeoutMs = 15000) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
    const text = await res.text()
    return { ok: res.ok, status: res.status, json: tryParseJson(text) }
  } catch (err) {
    return { ok: false, status: 0, json: null, err: err.name === 'TimeoutError' ? `timeout ${timeoutMs / 1000}s` : err.message }
  }
}

// Extracción mínima por regex (evita dependencia de un parser XML, solo para el fallback WFS).
function matchAll(xml, re) {
  const out = []
  let m
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}

/**
 * Diagnóstico cuando algo no salió como se esperaba: status, content-type,
 * tamaño, si parece HTML (URL/endpoint equivocado) o un ExceptionReport WFS,
 * y un fragmento crudo para inspeccionar sin repetir la llamada.
 */
function diagnosticar(res) {
  console.log(`\n[diagnóstico] HTTP ${res.status} · content-type: ${res.contentType} · ${res.text.length} bytes`)
  if (/<html[\s>]/i.test(res.text.slice(0, 500))) {
    console.log('[diagnóstico] La respuesta parece HTML, no JSON/XML — probable URL/ruta equivocada (¿redirect, login, 404 disfrazado?).')
  }
  const excMatch = res.text.match(/<(?:ows:)?ExceptionText>([^<]+)<\/(?:ows:)?ExceptionText>/i)
    || res.text.match(/<ServiceException[^>]*>([^<]+)<\/ServiceException>/i)
  if (excMatch) {
    console.log(`[diagnóstico] El servidor devolvió un ExceptionReport: "${excMatch[1].trim()}"`)
  }
  console.log(`[diagnóstico] Primeros 1500 caracteres de la respuesta:\n${res.text.slice(0, 1500)}`)
}

function tryParseJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

// Distintas sintaxis de paginación a probar antes de rendirse con un término.
// `extra` = solo el/los parámetro(s) de paginación (sin `q`), reutilizable
// para listar una colección completa sin filtro de búsqueda.
const PAGINATION_STRATEGIES = [
  { label: 'sin parámetro de paginación', extra: '', qs: (q) => `q=${encodeURIComponent(q)}` },
  { label: 'limit', extra: 'limit=10', qs: (q) => `q=${encodeURIComponent(q)}&limit=10` },
  { label: 'page[size] (JSON:API, bracket codificado)', extra: `${encodeURIComponent('page[size]')}=10`, qs: (q) => `q=${encodeURIComponent(q)}&${encodeURIComponent('page[size]')}=10` },
  { label: 'page + per_page', extra: 'page=1&per_page=10', qs: (q) => `q=${encodeURIComponent(q)}&page=1&per_page=10` },
]

// Si el término principal no encuentra nada, se prueban estos automáticamente
// (mismo run, sin round-trip humano) antes de rendirse.
const FALLBACK_TERMS = ['valor de suelo', 'suelo', 'observatorio', 'mercado de suelo', 'avaluo']

/**
 * Normaliza la respuesta del catálogo a una lista de items, sea cual sea el
 * formato real: JSON:API (`{data:[{id, attributes:{...}}]}`, típico de
 * hub.arcgis.com) u OGC API - Records/Features (`{features:[{id, properties,
 * links}]}`, típico de geoportales gubernamentales — que es lo que este
 * portal usa de verdad, según el primer run real).
 */
function extractItems(json) {
  if (Array.isArray(json.data)) {
    return json.data.map((it) => {
      const a = it.attributes ?? {}
      return { id: it.id, name: a.name ?? it.id, type: a.type ?? '?', url: a.url ?? null, slug: a.slug ?? null }
    })
  }
  if (Array.isArray(json.features)) {
    return json.features.map((f) => {
      const p = f.properties ?? {}
      const links = Array.isArray(f.links) ? f.links : (Array.isArray(p.links) ? p.links : [])
      const serviceLink = links.find((l) => /service|api|wfs|rest|arcgis/i.test(`${l.rel ?? ''} ${l.type ?? ''} ${l.href ?? ''}`))
      return {
        id: f.id ?? p.id ?? null,
        name: p.title ?? p.name ?? f.id ?? '(sin título)',
        type: p.type ?? p.recordType ?? '?',
        url: p.url ?? serviceLink?.href ?? null,
        slug: p.slug ?? null,
      }
    })
  }
  return []
}

function printItems(items) {
  for (const it of items) {
    console.log(`\n• ${it.name}`)
    console.log(`  id: ${it.id} · tipo: ${it.type}`)
    console.log(`  url servicio: ${it.url ?? '(sin url — puede ser un archivo descargable, no un servicio consultable)'}`)
    if (it.slug) console.log(`  página: ${HUB}/datasets/${it.slug}`)
  }
  console.log(`\nSiguiente paso: para el dataset correcto (valor de suelo), describí sus campos con:`)
  console.log(`  node scraper/a0-verify-fuentes.mjs --esri-describe "<url servicio de arriba>"`)
}

/** Una consulta al catálogo con una sintaxis de paginación dada. null si no funcionó. */
async function queryOnce(qs, label) {
  const url = `${HUB}/api/search/v1/collections/dataset/items?${qs}`
  console.log(`→ Hub search (${label}): ${url}`)
  const res = await get(url)
  const json = tryParseJson(res.text)
  if (!res.ok || !json || json.error || (typeof json.statusCode === 'number' && json.statusCode >= 400)) {
    console.log(`  ✗ HTTP ${res.status}${json ? ` — ${JSON.stringify(json)}` : ' (no es JSON)'}`)
    return null
  }
  console.log('  ✓ OK')
  return json
}

/** Lista las colecciones disponibles del catálogo — diagnóstico si ningún término encontró nada. */
async function listCollections() {
  const url = `${HUB}/api/search/v1/collections`
  console.log(`\n→ Listando colecciones disponibles: ${url}`)
  const res = await get(url)
  const json = tryParseJson(res.text)
  if (!res.ok || !json) {
    console.log(`  ✗ HTTP ${res.status}`)
    diagnosticar(res)
    return []
  }
  const cols = Array.isArray(json.collections) ? json.collections : []
  for (const c of cols) console.log(`  • ${c.id} — "${c.title}" (${c.description ?? ''})`)
  return cols.map((c) => c.id)
}

/**
 * Lista TODOS los items de una colección (sin filtro `q`) — diagnóstico final:
 * si la búsqueda por término no encontró nada, mostrar qué títulos existen de
 * verdad evita seguir adivinando keywords a ciegas.
 */
async function listAllItems(collectionId, workingStrategy) {
  const qs = workingStrategy?.extra || ''
  const url = `${HUB}/api/search/v1/collections/${collectionId}/items${qs ? `?${qs}` : ''}`
  console.log(`\n→ Listando items de "${collectionId}" (sin filtro): ${url}`)
  const res = await get(url)
  const json = tryParseJson(res.text)
  if (!res.ok || !json) {
    console.log(`  ✗ HTTP ${res.status}`)
    return
  }
  const items = extractItems(json)
  const matched = typeof json.numberMatched === 'number' ? ` (numberMatched: ${json.numberMatched})` : ''
  console.log(`  Total: ${items.length}${matched}`)
  for (const it of items.slice(0, 25)) {
    console.log(`  • ${it.name} (id: ${it.id}, tipo: ${it.type})${it.url ? ` → ${it.url}` : ''}`)
  }
}

/**
 * Muchos geoportales gubernamentales chilenos ("IDE" = Infraestructura de
 * Datos Espaciales) auto-hospedan ArcGIS Server aparte del catálogo Hub. Este
 * directorio REST clásico (`/arcgis/rest/services`) puede exponer las capas
 * directamente por carpeta/servicio, sin pasar por la búsqueda del Hub.
 */
async function checkArcgisServicesDirectory() {
  const url = `${HUB}/arcgis/rest/services?f=json`
  console.log(`\n→ Probando directorio ArcGIS Server clásico: ${url}`)
  const res = await get(url)
  const json = tryParseJson(res.text)
  if (!res.ok || !json) {
    console.log(`  ✗ HTTP ${res.status} — no hay ArcGIS Server propio en esta ruta.`)
    return
  }
  if (json.error) {
    console.log(`  ✗ ${JSON.stringify(json.error)}`)
    return
  }
  const folders = Array.isArray(json.folders) ? json.folders : []
  const services = Array.isArray(json.services) ? json.services : []
  console.log(`  ✓ Existe. Carpetas: ${folders.join(', ') || '(ninguna)'}`)
  console.log(`  Servicios en raíz: ${services.map((s) => `${s.name} (${s.type})`).join(', ') || '(ninguno)'}`)
  console.log(`  Explorar una carpeta: ${HUB}/arcgis/rest/services/<carpeta>?f=json`)
}

/**
 * Búsqueda de datasets en el catálogo del portal (API pública, sin auth).
 *
 * Primero determina qué sintaxis de paginación acepta el servidor (probando
 * varias en el mismo run), y la reutiliza para probar automáticamente varios
 * términos de búsqueda si el primero no encuentra nada — para no depender de
 * que el humano haga el round-trip término por término.
 */
async function search(term) {
  const terms = [term, ...FALLBACK_TERMS.filter((t) => t.toLowerCase() !== term.toLowerCase())]
  let workingStrategy = null

  for (const t of terms) {
    let json = null
    if (workingStrategy) {
      json = await queryOnce(workingStrategy.qs(t), `${workingStrategy.label} · término="${t}"`)
    } else {
      for (const strat of PAGINATION_STRATEGIES) {
        json = await queryOnce(strat.qs(t), `${strat.label} · término="${t}"`)
        if (json) { workingStrategy = strat; break }
      }
    }

    if (!json) {
      console.log(`\n✗ Ninguna estrategia de paginación funcionó para "${t}".`)
      continue
    }

    const items = extractItems(json)
    const matched = typeof json.numberMatched === 'number' ? ` (numberMatched: ${json.numberMatched})` : ''
    console.log(`Datasets para "${t}": ${items.length}${matched}`)
    if (items.length > 0) {
      printItems(items)
      return
    }
    console.log('  (sin resultados — probando el siguiente término...)')
  }

  console.log('\n✗ Ningún término encontró datasets. Diagnóstico final (sin adivinar más keywords):')
  const collectionIds = await listCollections()
  for (const id of collectionIds.length ? collectionIds : ['dataset', 'document']) {
    await listAllItems(id, workingStrategy)
  }
  await checkArcgisServicesDirectory()
}

// Heurísticas de campos para el comando ingest-minvu-suelo.mjs sugerido.
// "aval"/"uf" cazan avalúos y montos en UF; el humano confirma con el alias.
const VALOR_FIELD_RE = /uf_?m2|uf_?ha|valor|precio|monto|aval/i

function guessFields(fields) {
  return {
    valor: fields.find((f) => VALOR_FIELD_RE.test(f)) ?? null,
    zona: fields.find((f) => /zona|sector|barrio/i.test(f)) ?? null,
    comuna: fields.find((f) => /comuna|cut|cod_com/i.test(f)) ?? null,
  }
}

function printIngestCommand(layerUrl, g, indent = '  ') {
  console.log(`${indent}node scraper/ingest-minvu-suelo.mjs \\`)
  console.log(`${indent}  --esri-url "${layerUrl}" \\`)
  console.log(`${indent}  --field-valor ${g.valor ?? '<campo_UF_m2>'} \\`)
  if (g.zona) console.log(`${indent}  --field-zona ${g.zona} \\`)
  console.log(`${indent}  ${g.comuna ? `--field-comuna ${g.comuna}` : '--comuna 15108'} \\`)
  console.log(`${indent}  --periodo 2024 --dry-run`)
}

/**
 * Descompone una URL de servicio Esri REST: raíz del servicio y, si la URL ya
 * apunta a una capa concreta (…/FeatureServer/3), el id de esa capa.
 */
function parseServiceUrl(u) {
  const m = typeof u === 'string' ? u.match(/^(.*\/(?:FeatureServer|MapServer))(?:\/(\d+))?\/?(?:\?.*)?$/i) : null
  if (!m) return null
  return { root: m[1], layerId: m[2] != null ? Number(m[2]) : null }
}

/** Describe los campos de una capa Esri REST (FeatureServer/MapServer).
 *  Si la URL es la RAÍZ del servicio (sin /<n>), los `fields` no están ahí:
 *  lista las capas (`layers[]`/`tables[]`) y desciende a cada una. */
async function esriDescribe(layerUrl) {
  const sep = layerUrl.includes('?') ? '&' : '?'
  const url = `${layerUrl}${sep}f=json`
  console.log(`→ Describe ArcGIS REST: ${url}\n`)
  const res = await get(url)
  if (!res.ok) {
    console.log(`✗ HTTP ${res.status}`)
    diagnosticar(res)
    return
  }
  const json = tryParseJson(res.text)
  if (!json) {
    console.log('✗ La respuesta no es JSON válido.')
    diagnosticar(res)
    return
  }
  if (json.error) {
    console.log(`✗ Error del servicio: ${json.error.message ?? JSON.stringify(json.error)}`)
    return
  }

  const fieldDefs = Array.isArray(json.fields) ? json.fields : []

  // URL de raíz de servicio: sin fields propios — descender a las capas.
  const subLayers = [...(Array.isArray(json.layers) ? json.layers : []), ...(Array.isArray(json.tables) ? json.tables : [])]
  if (fieldDefs.length === 0 && subLayers.length > 0) {
    const base = layerUrl.replace(/\/+$/, '')
    console.log(`Es la raíz del servicio (${subLayers.length} capa(s)). Describiendo cada capa:\n`)
    for (const l of subLayers) {
      console.log(`── Capa ${l.id} · «${l.name}» ─ ${base}/${l.id}`)
      await esriDescribe(`${base}/${l.id}`)
      console.log('')
    }
    return
  }

  console.log(`Campos:`)
  if (fieldDefs.length === 0) {
    console.log('  (ninguno encontrado)')
    diagnosticar(res)
    return
  }
  for (const f of fieldDefs) {
    console.log(`  - ${f.name} (${f.type}${f.alias && f.alias !== f.name ? `, alias: "${f.alias}"` : ''})`)
  }

  const g = guessFields(fieldDefs.map((f) => f.name))
  console.log(`\nComando sugerido (ajustá los campos si el guess no es exacto):`)
  printIngestCommand(layerUrl, g)
}

/** Fallback: GeoServer WFS clásico (ej. otros portales, no MINVU). */
async function capabilities() {
  const url = `${WFS}?service=WFS&version=2.0.0&request=GetCapabilities`
  console.log(`→ GetCapabilities: ${url}\n`)
  const res = await get(url)
  if (!res.ok) {
    console.log(`✗ HTTP ${res.status}`)
    diagnosticar(res)
    return
  }
  const names = matchAll(res.text, /<(?:\w+:)?Name>([^<]+)<\/(?:\w+:)?Name>/g)
  const uniq = [...new Set(names)]
  const candidatas = uniq.filter(n => /suelo|valor|mercado|observatorio|transacc/i.test(n))

  console.log(`Capas totales: ${uniq.length}`)

  if (uniq.length === 0) {
    console.log('\n⚠ GetCapabilities respondió 200 pero no se encontró ningún <Name> de capa.')
    diagnosticar(res)
    console.log('\nEste portal probablemente no es GeoServer clásico. Probá el modo --search (Hub/Esri).')
    return
  }

  console.log(`\nCandidatas (valor de suelo / mercado):`)
  if (candidatas.length === 0) {
    console.log('  (ninguna coincide por nombre — revisa la lista completa abajo)')
  } else {
    for (const c of candidatas) console.log(`  • ${c}`)
  }
  console.log(`\nTodas las capas:`)
  for (const n of uniq) console.log(`  - ${n}`)
  console.log(`\nSiguiente paso: node scraper/a0-verify-fuentes.mjs --describe <capa>`)
}

async function describe(layer) {
  const url = `${WFS}?service=WFS&version=2.0.0&request=DescribeFeatureType&typeName=${encodeURIComponent(layer)}`
  console.log(`→ DescribeFeatureType: ${layer}\n`)
  const res = await get(url)
  if (!res.ok) {
    console.log(`✗ HTTP ${res.status}`)
    diagnosticar(res)
    return
  }
  const fields = matchAll(res.text, /<(?:\w+:)?element[^>]*\bname="([^"]+)"/g)
  console.log(`Campos de "${layer}":`)
  if (fields.length === 0) {
    console.log('  (ninguno encontrado)')
    diagnosticar(res)
    return
  }
  for (const f of fields) console.log(`  - ${f}`)

  const valorGuess = fields.find(f => /uf.*m2|valor|precio|monto/i.test(f))
  const zonaGuess = fields.find(f => /zona|id|codigo|cod_/i.test(f))
  const comunaGuess = fields.find(f => /comuna|cut|cod_com/i.test(f))

  console.log(`\nComando sugerido (ajusta los campos si el guess no es exacto):`)
  console.log(`  node scraper/ingest-minvu-suelo.mjs \\`)
  console.log(`    --wfs-url ${WFS} \\`)
  console.log(`    --layer ${layer} \\`)
  console.log(`    --field-valor ${valorGuess ?? '<campo_UF_m2>'} \\`)
  if (zonaGuess) console.log(`    --field-zona ${zonaGuess} \\`)
  console.log(`    ${comunaGuess ? `--field-comuna ${comunaGuess}` : '--comuna 15108'} \\`)
  console.log(`    --periodo 2024 --dry-run`)
}

/** Link rel=next de una respuesta OGC API (paginación robusta, sin adivinar offset). */
function nextLink(json, currentUrl) {
  const href = Array.isArray(json.links) ? json.links.find((l) => l.rel === 'next')?.href : null
  if (!href) return null
  try { return new URL(href, currentUrl).toString() } catch { return null }
}

/**
 * Modo automático v2: inspecciona TODAS las capas de TODOS los servicios del
 * catálogo buscando campos de valor de suelo.
 *
 * Lecciones del primer run (2026-07-13, inconcluso):
 *  1. Los `fields` NO están en la raíz del FeatureServer — están en cada capa
 *     (`…/FeatureServer/<n>?f=json`). El run v1 miraba solo la raíz, así que
 *     nunca vio un campo de verdad ("Sin campos de valor; campos: ..." vacío).
 *  2. Un solo timeout de 60s abortaba el run entero → ahora cada request es
 *     tolerante a fallos (getJsonSafe) y con timeout corto.
 *  3. El catálogo pagina de a 10-50 → ahora se siguen los links rel=next.
 *  4. Servicios duplicados entre items → dedupe por raíz de servicio.
 */
async function autoFindValor() {
  const t0 = Date.now()
  const DEADLINE_MS = 10 * 60 * 1000 // presupuesto duro: resumen parcial antes que morir sin reporte
  const expired = () => Date.now() - t0 > DEADLINE_MS

  console.log(`→ Modo automático v2: inspeccionando capa por capa (fields viven en …/FeatureServer/<n>, no en la raíz)\n`)

  const collectionIds = await listCollections()
  // "all" es superconjunto de las demás; si existe, basta con esa.
  const scanIds = collectionIds.includes('all') ? ['all'] : (collectionIds.length ? collectionIds : ['dataset'])

  const seenRoots = new Set()
  const candidates = []
  const failures = []
  let services = 0
  let layersScanned = 0

  for (const cid of scanIds) {
    let pageUrl = `${HUB}/api/search/v1/collections/${cid}/items?limit=50`
    for (let page = 0; pageUrl && page < 20 && !expired(); page++) {
      const { ok, status, json, err } = await getJsonSafe(pageUrl, 20000)
      if (!ok || !json) {
        console.log(`✗ Página de catálogo falló (HTTP ${status}${err ? ` · ${err}` : ''}): ${pageUrl}`)
        break
      }

      for (const item of extractItems(json)) {
        if (expired()) break
        const svc = parseServiceUrl(item.url)
        if (!svc) continue // dashboards, docs, webmaps: sin servicio consultable
        if (seenRoots.has(svc.root)) continue
        seenRoots.add(svc.root)
        services++

        // Raíz del servicio → lista de capas reales.
        const root = await getJsonSafe(`${svc.root}?f=json`)
        if (!root.json || root.json.error) {
          const why = root.json?.error ? (root.json.error.message ?? JSON.stringify(root.json.error)) : `HTTP ${root.status}${root.err ? ` · ${root.err}` : ''}`
          console.log(`• ${item.name} — ✗ raíz no describible: ${why}`)
          failures.push({ name: item.name, url: svc.root, why })
          continue
        }

        const subLayers = [
          ...(Array.isArray(root.json.layers) ? root.json.layers : []),
          ...(Array.isArray(root.json.tables) ? root.json.tables : []),
        ].slice(0, 12)

        if (subLayers.length === 0) {
          console.log(`• ${item.name} — 0 capas en la raíz`)
          continue
        }

        console.log(`• ${item.name} — ${subLayers.length} capa(s)`)
        for (const l of subLayers) {
          if (expired()) break
          const layerUrl = `${svc.root}/${l.id}`
          const desc = await getJsonSafe(`${layerUrl}?f=json`)
          layersScanned++
          if (!desc.json || desc.json.error) {
            const why = desc.json?.error ? (desc.json.error.message ?? JSON.stringify(desc.json.error)) : `HTTP ${desc.status}${desc.err ? ` · ${desc.err}` : ''}`
            console.log(`    - ${l.id} «${l.name}» ✗ ${why}`)
            failures.push({ name: `${item.name} / ${l.name}`, url: layerUrl, why })
            continue
          }
          const fields = Array.isArray(desc.json.fields) ? desc.json.fields.map((f) => f.name) : []
          const g = guessFields(fields)
          if (g.valor) {
            console.log(`    - ${l.id} «${l.name}» ✓ VALOR: ${g.valor}${g.comuna ? ` · comuna: ${g.comuna}` : ''}${g.zona ? ` · zona: ${g.zona}` : ''}`)
            candidates.push({ service: item.name, layer: l.name, layerUrl, fields, g })
          } else {
            console.log(`    - ${l.id} «${l.name}» sin valor (${fields.length} campos: ${fields.slice(0, 6).join(', ')}${fields.length > 6 ? '…' : ''})`)
          }
          await sleep(120) // ritmo respetuoso: son decenas de requests de metadatos
        }
      }

      pageUrl = nextLink(json, pageUrl)
    }
  }

  // ── Resumen ────────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Resumen: ${services} servicio(s) · ${layersScanned} capa(s) inspeccionada(s) · ${candidates.length} candidata(s) · ${failures.length} fallo(s)${expired() ? ' · ⚠ CORTADO por presupuesto de tiempo (resultado PARCIAL)' : ''}`)

  if (failures.length > 0) {
    console.log(`\nCapas/servicios que no se pudieron describir (revisar a mano si alguna suena a suelo):`)
    for (const f of failures) console.log(`  ✗ ${f.name} → ${f.url}\n     ${f.why}`)
  }

  if (candidates.length === 0) {
    console.log(`\n✗ Ninguna capa inspeccionada tiene campos de valor.`)
    console.log(`  Si el resumen dice PARCIAL, relanzá. Si fue completo: el dato no está en este Hub —`)
    console.log(`  correr el modo sii_ckan (busca el dataset en datos.gob.cl/Observatorio Urbano) o pivotar a SII agregado.`)
    return
  }

  console.log(`\n✓ ${candidates.length} capa(s) con campos de valor — elegir la del Observatorio de Mercado de Suelo:\n`)
  for (const c of candidates) {
    console.log(`▶ ${c.service} / «${c.layer}»`)
    console.log(`  ${c.layerUrl}`)
    console.log(`  campos: ${c.fields.join(', ')}`)
    printIngestCommand(c.layerUrl, c.g)
    console.log('')
  }
}

async function main() {
  try {
    if (values['auto-find-valor']) await autoFindValor()
    else if (values['esri-describe']) await esriDescribe(values['esri-describe'])
    else if (values.wfs && values.describe) await describe(values.describe)
    else if (values.wfs) await capabilities()
    else await search(values.search || DEFAULT_TERM)
  } catch (err) {
    console.error(`\n✗ ${err.message}`)
    console.error('  Si es un 403/timeout: este host está bloqueado en el entorno de build; corre el script en el VPS o en local.')
    process.exit(1)
  }
}

main()
