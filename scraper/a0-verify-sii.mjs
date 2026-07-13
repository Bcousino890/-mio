#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// a0-verify-sii.mjs — Paso A0 · Fase 2 parte 2: verifica qué publican REALMENTE
// las fuentes AGREGADAS chilenas, antes de escribir parsers a ciegas:
//
//   1. SII — páginas de "estadísticas de bienes raíces": ¿publican TRANSFERENCIAS
//      (nº de operaciones + monto) o solo avalúos/contribuciones? Extrae los
//      links a CSV/XLSX/ZIP reales y reporta content-type + tamaño de cada uno.
//   2. Observatorio Urbano MINVU (observatoriourbano.cl) — históricamente publica
//      el indicador "precio de suelo urbano"; el dataset de valor de suelo que NO
//      apareció en ide.minvu.cl (ver run 2026-07-13 de --auto-find-valor) puede
//      vivir aquí.
//   3. datos.gob.cl (CKAN API) — catálogo central del Estado: busca datasets de
//      transferencias / valor de suelo / MINVU con sus recursos descargables.
//
// Es SOLO LECTURA (no escribe en la BD) y sin dependencias. Correr donde la red
// a sii.cl / minvu.cl / datos.gob.cl esté abierta (VPS vía workflow
// verify-mercado-fuentes.yml modo `sii_ckan`; el build de Claude bloquea esos
// hosts con 403).
//
// USO:
//   node scraper/a0-verify-sii.mjs                       # sondas por defecto
//   node scraper/a0-verify-sii.mjs --url https://…       # sondear además esa página
//   node scraper/a0-verify-sii.mjs --term "compraventas" # término CKAN extra
//   node scraper/a0-verify-sii.mjs --skip-ckan           # solo páginas SII/MINVU
//
// Salida esperada: la lista de archivos/datasets reales con URL + formato, para
// documentar en docs/RUNBOOK-MERCADO-CL.md y alimentar los importadores CSV
// (POST /api/admin/mercado-agregado-upload · avaluo-historico-upload).
// ─────────────────────────────────────────────────────────────────────────────
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    url: { type: 'string', multiple: true },
    term: { type: 'string', multiple: true },
    'skip-ckan': { type: 'boolean' },
    'skip-pages': { type: 'boolean' },
  },
})

const UA = 'CasafariMIO/1.0 (+verificacion A0 fuentes agregadas de mercado)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Páginas semilla — iteradas con el run 2026-07-13:
//  · Las 4 rutas conjeturadas del SII dieron 404 (el sitio se reorganizó) →
//    ahora se parte del home y de /estadisticas/, dejando que el seguimiento
//    de nivel 2 encuentre la sección real de bienes raíces.
//  · observatoriourbano.minvu.cl REDIRIGE a centrodeestudios.minvu.gob.cl —
//    el Centro de Estudios MINVU es el hogar actual del Observatorio del
//    Mercado de Suelo → se sondean sus secciones de estadísticas directamente.
// Run v3: www.sii.cl es un meta-refresh a homer.sii.cl, y /estadisticas/ es un
// redirect JS a /destacados/ogp/ (¡el portal OGP del plan!). Semillas directas.
const SII_PAGES = [
  'https://homer.sii.cl/',
  'https://www.sii.cl/destacados/ogp/',
  'https://www.sii.cl/estadisticas/',
]
const MINVU_PAGES = [
  'https://centrodeestudios.minvu.gob.cl/analisis-estadistico-y-economico/',
  'https://centrodeestudios.minvu.gob.cl/?sfid=1119&_sft_categoria_repositorio=estadisticas',
  'https://observatoriourbano.minvu.cl',
]
const CKAN_BASE = 'https://datos.gob.cl/api/3/action/package_search'
const CKAN_TERMS = [
  'transferencias bienes raices',
  'valor de suelo',
  'mercado de suelo',
]

// Catálogo Koha del Centro de Estudios MINVU (descubierto en run 2026-07-13:
// el repositorio "Estadísticas" enlaza a catalogo.minvu.cl con descargas vía
// opac-retrieve-file.pl). Buscar ahí directamente el Observatorio del Mercado
// de Suelo, sin pasar por el buscador WordPress.
const KOHA_BASE = 'https://catalogo.minvu.cl/cgi-bin/koha/opac-search.pl'
const KOHA_TERMS = ['mercado de suelo', 'precio de suelo', 'valor de suelo', 'suelo urbano']

// Qué links nos interesan dentro de una página HTML (pdf incluido: en el
// Centro de Estudios MINVU los indicadores se publican como XLSX + PDF).
const DATA_FILE_RE = /\.(csv|xlsx?|zip|json|ods|pdf)(\?|#|$)/i
const TOPIC_RE = /bienes|ra[ií]ces|transferencia|compraventa|avalu|suelo|estad[ií]stic|mercado/i

async function fetchSafe(url, { method = 'GET', timeoutMs = 30000 } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'User-Agent': UA, Accept: '*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const contentType = res.headers.get('content-type') || '?'
    const length = res.headers.get('content-length')
    const text = method === 'GET' ? await res.text() : ''
    return { ok: res.ok, status: res.status, contentType, length, text, finalUrl: res.url }
  } catch (err) {
    // err.cause trae el porqué real (ENOTFOUND, CERT_HAS_EXPIRED, ECONNREFUSED…)
    // — "fetch failed" a secas no permite decidir el siguiente paso (run v3, Koha).
    const why = err.name === 'TimeoutError' ? 'timeout' : (err.cause?.code ?? err.cause?.message ?? err.message)
    return { ok: false, status: 0, contentType: '?', length: null, text: '', err: why }
  }
}

/** Detecta redirects que fetch NO sigue: <meta http-equiv=refresh> y window.location por JS. */
function softRedirect(html, baseUrl) {
  const meta = html.match(/http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*url\s*=\s*([^"'\s>]+)/i)
    || html.match(/content\s*=\s*["']\d+\s*;\s*url\s*=\s*([^"'\s>]+)["'][^>]*http-equiv\s*=\s*["']?refresh/i)
  const js = html.match(/window\.location(?:\.href)?\s*(?:=|\.replace\s*\()\s*["']([^"']+)["']/i)
  const target = meta?.[1] ?? js?.[1]
  if (!target) return null
  try { return new URL(target, baseUrl).toString() } catch { return null }
}

/** Extrae <a href> de un HTML con regex (sin dependencias), href absolutizado. */
function extractLinks(html, baseUrl) {
  const out = []
  const re = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi
  let m
  while ((m = re.exec(html)) !== null && out.length < 500) {
    const raw = m[1] ?? m[2] ?? ''
    if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel):/i.test(raw)) continue
    let href
    try { href = new URL(raw, baseUrl).toString() } catch { continue }
    const text = m[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
    out.push({ href, text })
  }
  return out
}

/** Sondea una página: status real, y si es HTML, los links de datos/tema. */
async function probePage(url, { follow = true, hops = 0 } = {}) {
  console.log(`\n→ ${url}`)
  const res = await fetchSafe(url)
  if (!res.ok) {
    console.log(`  ✗ HTTP ${res.status}${res.err ? ` · ${res.err}` : ''} — no existe o bloqueada; se descarta esta ruta.`)
    return { dataLinks: [], pageLinks: [] }
  }
  console.log(`  ✓ HTTP ${res.status} · ${res.contentType}${res.finalUrl && res.finalUrl !== url ? ` · redirigida a ${res.finalUrl}` : ''}`)

  // Redirect "blando" (meta refresh / window.location, run v3: sii.cl usa ambos).
  const soft = /html/i.test(res.contentType) && res.text.length < 4000 ? softRedirect(res.text, res.finalUrl || url) : null
  if (soft && hops < 2) {
    console.log(`  ↪ redirect blando (meta/JS) → ${soft}`)
    return probePage(soft, { follow, hops: hops + 1 })
  }
  if (!/html/i.test(res.contentType)) {
    console.log(`  (no es HTML — es un recurso directo de ${res.length ?? '?'} bytes)`)
    return { dataLinks: [{ href: url, text: '(directo)' }], pageLinks: [] }
  }

  const links = extractLinks(res.text, res.finalUrl || url)
  const dataLinks = links.filter((l) => DATA_FILE_RE.test(l.href))
  const pageLinks = links.filter((l) => !DATA_FILE_RE.test(l.href) && TOPIC_RE.test(`${l.href} ${l.text}`))

  if (dataLinks.length) {
    console.log(`  Archivos de datos enlazados (${dataLinks.length}):`)
    for (const l of dataLinks.slice(0, 40)) console.log(`    • ${l.text || '(sin texto)'} → ${l.href}`)
  }
  if (pageLinks.length) {
    console.log(`  Páginas relacionadas al tema (${pageLinks.length}):`)
    for (const l of pageLinks.slice(0, 25)) console.log(`    · ${l.text || '(sin texto)'} → ${l.href}`)
  }
  if (!dataLinks.length && !pageLinks.length) {
    // Diagnóstico: distinguir "página irrelevante" de "HTML sin <a> (menús por JS)".
    if (links.length === 0) {
      console.log(`  ⚠ 0 links <a> en el HTML (${res.text.length} bytes) — probable sitio con menús por JS.`)
      console.log(`  Primeros 300 chars: ${res.text.slice(0, 300).replace(/\s+/g, ' ')}`)
    } else {
      console.log(`  (${links.length} links, ninguno de datos/tema — muestro los primeros 15 para diagnóstico)`)
      for (const l of links.slice(0, 15)) console.log(`    - ${l.text || '(sin texto)'} → ${l.href}`)
    }
  }

  // Nivel 2: seguir las sub-páginas más prometedoras buscando archivos.
  const collected = [...dataLinks]
  if (follow && dataLinks.length < 3 && pageLinks.length > 0) {
    const seen = new Set()
    for (const sub of pageLinks.slice(0, 6)) {
      if (seen.has(sub.href)) continue
      seen.add(sub.href)
      const subRes = await fetchSafe(sub.href)
      if (!subRes.ok || !/html/i.test(subRes.contentType)) continue
      const subData = extractLinks(subRes.text, subRes.finalUrl || sub.href).filter((l) => DATA_FILE_RE.test(l.href))
      if (subData.length) {
        console.log(`  ↳ ${sub.href} contiene ${subData.length} archivo(s):`)
        for (const l of subData.slice(0, 20)) console.log(`      • ${l.text || '(sin texto)'} → ${l.href}`)
        collected.push(...subData)
      }
      await sleep(400)
    }
  }
  return { dataLinks: collected, pageLinks }
}

/** HEAD a los archivos hallados: confirma content-type y tamaño sin bajarlos. */
async function headFiles(links) {
  const uniq = [...new Map(links.map((l) => [l.href, l])).values()].slice(0, 10)
  if (!uniq.length) return
  console.log(`\n→ Verificando ${uniq.length} archivo(s) con HEAD:`)
  for (const l of uniq) {
    const res = await fetchSafe(l.href, { method: 'HEAD', timeoutMs: 15000 })
    const size = res.length ? `${(Number(res.length) / 1024).toFixed(0)} KB` : 'tamaño ?'
    console.log(`  ${res.ok ? '✓' : '✗'} [${res.status}] ${l.href} · ${res.contentType} · ${size}`)
    await sleep(300)
  }
}

/**
 * Busca en el catálogo Koha del Centro de Estudios MINVU y lista los registros
 * (biblionumber + título) y los links de descarga directa (opac-retrieve-file).
 */
async function kohaSearch(term) {
  const url = `${KOHA_BASE}?q=${encodeURIComponent(term)}`
  console.log(`\n→ Koha catalogo.minvu.cl · q="${term}"`)
  let res = await fetchSafe(url)
  if (!res.ok && res.status === 0) {
    // Run v3: https falló a nivel de red (probable cert). Reintento por http.
    const httpUrl = url.replace(/^https:/, 'http:')
    console.log(`  ✗ https falló (${res.err}) — reintento http: ${httpUrl}`)
    res = await fetchSafe(httpUrl)
  }
  if (!res.ok) {
    console.log(`  ✗ HTTP ${res.status}${res.err ? ` · ${res.err}` : ''}`)
    return
  }
  const links = extractLinks(res.text, res.finalUrl || url)
  const records = new Map()
  for (const l of links) {
    const m = l.href.match(/opac-detail\.pl\?biblionumber=(\d+)/)
    if (m && l.text && !records.has(m[1])) records.set(m[1], { title: l.text, href: l.href })
  }
  const files = links.filter((l) => /opac-retrieve-file\.pl|tracklinks\.pl/.test(l.href))
  const nRes = res.text.match(/(\d[\d.,]*)\s+(?:resultado|result)/i)?.[1]
  console.log(`  ${records.size} registro(s)${nRes ? ` (el catálogo reporta ${nRes})` : ''}:`)
  for (const [num, r] of [...records].slice(0, 15)) console.log(`  • [${num}] ${r.title}\n      ${r.href}`)
  for (const f of files.slice(0, 10)) console.log(`  ↓ archivo: ${f.text || '(sin texto)'} → ${f.href}`)
  if (records.size === 0 && files.length === 0) console.log(`  (sin registros — ${links.length} links en la página)`)
}

/** Busca en el CKAN de datos.gob.cl y lista datasets + recursos descargables. */
async function ckanSearch(term) {
  const url = `${CKAN_BASE}?q=${encodeURIComponent(term)}&rows=10`
  console.log(`\n→ CKAN datos.gob.cl · q="${term}"`)
  const res = await fetchSafe(url)
  if (!res.ok) {
    console.log(`  ✗ HTTP ${res.status}${res.err ? ` · ${res.err}` : ''}`)
    return
  }
  let json
  try { json = JSON.parse(res.text) } catch { console.log('  ✗ respuesta no-JSON'); return }
  if (!json.success || !json.result) { console.log(`  ✗ CKAN respondió success=false`); return }

  console.log(`  ${json.result.count} dataset(s) en total; primeros ${json.result.results.length}:`)
  for (const pkg of json.result.results) {
    const org = pkg.organization?.title ?? '?'
    console.log(`  • ${pkg.title} [${org}]`)
    const resources = (pkg.resources ?? []).filter((r) => /csv|xls|zip|json|api|wms|wfs/i.test(r.format ?? ''))
    for (const r of resources.slice(0, 5)) console.log(`      - ${r.format}: ${r.url}`)
    if ((pkg.resources ?? []).length && !resources.length) console.log(`      (recursos sin formato tabular: ${pkg.resources.map((r) => r.format).join(', ')})`)
  }
}

async function main() {
  const extraPages = values.url ?? []
  const allData = []

  if (!values['skip-pages']) {
    console.log('═'.repeat(70))
    console.log('1) SII — estadísticas de bienes raíces (¿transferencias o solo avalúo?)')
    console.log('═'.repeat(70))
    for (const u of SII_PAGES) allData.push(...(await probePage(u)).dataLinks)

    console.log(`\n${'═'.repeat(70)}`)
    console.log('2) Observatorio Urbano MINVU (candidato a "valor de suelo" fuera del Hub)')
    console.log('═'.repeat(70))
    for (const u of MINVU_PAGES) allData.push(...(await probePage(u)).dataLinks)

    for (const u of extraPages) allData.push(...(await probePage(u)).dataLinks)

    console.log(`\n${'═'.repeat(70)}`)
    console.log('2.5) Catálogo Koha del Centro de Estudios MINVU (búsqueda directa)')
    console.log('═'.repeat(70))
    for (const t of KOHA_TERMS) {
      await kohaSearch(t)
      await sleep(500)
    }

    // Fallback si Koha no responde: el buscador WordPress del Centro de Estudios
    // (dominio que SÍ funciona) enlaza los mismos archivos vía tracklinks.pl.
    console.log(`\n${'═'.repeat(70)}`)
    console.log('2.6) Buscador del Centro de Estudios (WordPress, mismo repositorio)')
    console.log('═'.repeat(70))
    for (const t of ['mercado de suelo', 'precio de suelo']) {
      const u = `https://centrodeestudios.minvu.gob.cl/resultados/?_sft_categoria_repositorio=estadisticas&_sf_s=${encodeURIComponent(t)}`
      allData.push(...(await probePage(u, { follow: false })).dataLinks)
      const u2 = `https://centrodeestudios.minvu.gob.cl/?s=${encodeURIComponent(t)}`
      allData.push(...(await probePage(u2, { follow: false })).dataLinks)
      await sleep(400)
    }

    await headFiles(allData)
  }

  if (!values['skip-ckan']) {
    console.log(`\n${'═'.repeat(70)}`)
    console.log('3) datos.gob.cl (CKAN) — catálogo central del Estado')
    console.log('═'.repeat(70))
    const terms = [...CKAN_TERMS, ...(values.term ?? [])]
    for (const t of terms) {
      await ckanSearch(t)
      await sleep(500)
    }
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log('Siguiente paso: con las URLs reales de arriba, documentar el formato en')
  console.log('docs/RUNBOOK-MERCADO-CL.md (Fase 3) y cargar vía los importadores CSV:')
  console.log('  POST /api/admin/mercado-agregado-upload   (sii_comuna_code;periodo;n_operaciones;monto_total_uf)')
  console.log('  POST /api/admin/avaluo-historico-upload   (sii_comuna_code;rol;periodo;avaluo_total;avaluo_exento)')
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`)
  console.error('  Si es un 403/timeout: host bloqueado en el build; correr en el VPS (workflow modo sii_ckan).')
  process.exit(1)
})
