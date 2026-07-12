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
//   3. --wfs / --describe <capa>: fallback GeoServer WFS clásico (otros portales).
//
// USO:
//   node scraper/a0-verify-fuentes.mjs                          # busca "valor de suelo"
//   node scraper/a0-verify-fuentes.mjs --search "observatorio mercado de suelo"
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
const PAGINATION_STRATEGIES = [
  { label: 'sin parámetro de paginación', qs: (q) => `q=${encodeURIComponent(q)}` },
  { label: 'limit', qs: (q) => `q=${encodeURIComponent(q)}&limit=10` },
  { label: 'page[size] (JSON:API, bracket codificado)', qs: (q) => `q=${encodeURIComponent(q)}&${encodeURIComponent('page[size]')}=10` },
  { label: 'page + per_page', qs: (q) => `q=${encodeURIComponent(q)}&page=1&per_page=10` },
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

/** Lista las colecciones disponibles del catálogo — diagnóstico final si ningún término encontró nada. */
async function listCollections() {
  const url = `${HUB}/api/search/v1/collections`
  console.log(`\n→ Listando colecciones disponibles: ${url}`)
  const res = await get(url)
  const json = tryParseJson(res.text)
  if (!res.ok || !json) {
    console.log(`  ✗ HTTP ${res.status}`)
    diagnosticar(res)
    return
  }
  console.log(`  ${JSON.stringify(json).slice(0, 1500)}`)
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

  console.log('\n✗ Ningún término encontró datasets.')
  console.log('  Probá manualmente con --search "<otro término>" (quizás el título real es distinto),')
  console.log('  o revisá qué colecciones expone este catálogo:')
  await listCollections()
}

/** Describe los campos de una capa Esri REST (FeatureServer/MapServer). */
async function esriDescribe(layerUrl) {
  const sep = layerUrl.includes('?') ? '&' : '?'
  const url = `${layerUrl}${sep}f=json`
  console.log(`→ Describe capa ArcGIS REST: ${url}\n`)
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
  console.log(`Campos:`)
  if (fieldDefs.length === 0) {
    console.log('  (ninguno encontrado)')
    diagnosticar(res)
    return
  }
  for (const f of fieldDefs) {
    console.log(`  - ${f.name} (${f.type}${f.alias && f.alias !== f.name ? `, alias: "${f.alias}"` : ''})`)
  }

  const fields = fieldDefs.map(f => f.name)
  const valorGuess = fields.find(f => /uf.*m2|valor|precio|monto/i.test(f))
  const zonaGuess = fields.find(f => /zona|objectid|^id$/i.test(f))
  const comunaGuess = fields.find(f => /comuna|cut|cod_com/i.test(f))

  console.log(`\nComando sugerido (ajustá los campos si el guess no es exacto):`)
  console.log(`  node scraper/ingest-minvu-suelo.mjs \\`)
  console.log(`    --esri-url "${layerUrl}" \\`)
  console.log(`    --field-valor ${valorGuess ?? '<campo_UF_m2>'} \\`)
  if (zonaGuess) console.log(`    --field-zona ${zonaGuess} \\`)
  console.log(`    ${comunaGuess ? `--field-comuna ${comunaGuess}` : '--comuna 15108'} \\`)
  console.log(`    --periodo 2024 --dry-run`)
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

async function main() {
  try {
    if (values['esri-describe']) await esriDescribe(values['esri-describe'])
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
