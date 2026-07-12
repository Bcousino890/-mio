#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// a0-verify-fuentes.mjs — Paso A0 (Fase 2): verifica las fuentes públicas de
// mercado ANTES de cargar a escala. Correr donde la red a ide.minvu.cl esté
// abierta (VPS o local del usuario; el entorno de build de Claude bloquea ese
// host con 403).
//
// Qué hace:
//   1. GetCapabilities del WFS de MINVU → lista las capas cuyo nombre sugiere
//      "valor de suelo / mercado" (candidatas para --layer del scraper).
//   2. DescribeFeatureType de la capa elegida → lista sus campos, para fijar
//      --field-valor / --field-zona / --field-comuna del scraper.
//
// USO:
//   node scraper/a0-verify-fuentes.mjs
//   node scraper/a0-verify-fuentes.mjs --describe <nombre_capa>
//   node scraper/a0-verify-fuentes.mjs --wfs-url https://otra/geoserver/wfs
//
// Salida: imprime los comandos ingest-minvu-suelo.mjs sugeridos con los flags ya
// rellenados. NO escribe en la BD.
// ─────────────────────────────────────────────────────────────────────────────
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    'wfs-url': { type: 'string' },
    describe: { type: 'string' },
  },
})

const WFS = values['wfs-url'] || process.env.MINVU_WFS_URL || 'https://ide.minvu.cl/geoserver/wfs'
const UA = 'CasafariMIO/1.0 (+verificacion A0 open data MINVU)'

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) })
  const text = await res.text()
  const contentType = res.headers.get('content-type') || '(sin content-type)'
  return { ok: res.ok, status: res.status, contentType, text }
}

// Extracción mínima por regex (evita dependencia de un parser XML).
function matchAll(xml, re) {
  const out = []
  let m
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}

/**
 * Diagnóstico cuando algo no salió como se esperaba: status, content-type,
 * tamaño, si parece HTML (URL/endpoint equivocado) o un ExceptionReport WFS
 * (servicio/versión no soportada, capa inexistente, etc.), y un fragmento
 * crudo para inspeccionar a ojo sin tener que repetir la llamada.
 */
function diagnosticar(res) {
  console.log(`\n[diagnóstico] HTTP ${res.status} · content-type: ${res.contentType} · ${res.text.length} bytes`)
  if (/<html[\s>]/i.test(res.text.slice(0, 500))) {
    console.log('[diagnóstico] La respuesta parece HTML, no XML — probable URL/ruta equivocada (¿redirect, login, 404 disfrazado?).')
  }
  const excMatch = res.text.match(/<(?:ows:)?ExceptionText>([^<]+)<\/(?:ows:)?ExceptionText>/i)
    || res.text.match(/<ServiceException[^>]*>([^<]+)<\/ServiceException>/i)
  if (excMatch) {
    console.log(`[diagnóstico] El servidor devolvió un ExceptionReport: "${excMatch[1].trim()}"`)
  }
  console.log(`[diagnóstico] Primeros 1500 caracteres de la respuesta:\n${res.text.slice(0, 1500)}`)
}

async function capabilities() {
  const url = `${WFS}?service=WFS&version=2.0.0&request=GetCapabilities`
  console.log(`→ GetCapabilities: ${url}\n`)
  const res = await get(url)
  if (!res.ok) {
    console.log(`✗ HTTP ${res.status}`)
    diagnosticar(res)
    return
  }
  // Nombres de FeatureType (WFS 2.0.0). Tolerante a namespaces (Name / wfs:Name).
  const names = matchAll(res.text, /<(?:\w+:)?Name>([^<]+)<\/(?:\w+:)?Name>/g)
  const uniq = [...new Set(names)]
  const candidatas = uniq.filter(n => /suelo|valor|mercado|observatorio|transacc/i.test(n))

  console.log(`Capas totales: ${uniq.length}`)

  if (uniq.length === 0) {
    console.log('\n⚠ GetCapabilities respondió 200 pero no se encontró ningún <Name> de capa.')
    diagnosticar(res)
    console.log('\nPosibles causas: la ruta base del WFS no es esta (probar con --wfs-url otra),')
    console.log('el servicio requiere otro path (ej. /geoserver/<workspace>/wfs), o devolvió un')
    console.log('ExceptionReport (ver arriba). Revisa el fragmento crudo para decidir el siguiente intento.')
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

  console.log(`\nSiguiente paso:`)
  console.log(`  node scraper/a0-verify-fuentes.mjs --describe <capa>`)
  console.log(`  (usa una de las candidatas para ver sus campos)`)
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
    if (values.describe) await describe(values.describe)
    else await capabilities()
  } catch (err) {
    console.error(`\n✗ ${err.message}`)
    console.error('  Si es un 403/timeout: este host está bloqueado en el entorno de build; corre el script en el VPS o en local.')
    process.exit(1)
  }
}

main()
