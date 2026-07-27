#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// test-free-catastro-cl.mjs — Tester de fuentes GRATUITAS para rellenar los
// datos que faltan para "matchear perfecto" en Chile.
//
// Ver docs/MATCHING-CL-DATA-GAPS.md. Comprueba EN VIVO qué fuente gratuita y
// legítima está disponible y qué hueco (G1..G4) cubre cada una, e intenta una
// resolución real por punto (point-in-polygon) o por comuna.
//
// Huecos que perseguimos:
//   G1 = geometría predial (polígonos) para point-in-polygon
//   G2 = coordenada/centroide por ROL
//   G3 = sub-rol de unidad (copropiedad)  [se resuelve por huella física, no aquí]
//   G4 = cobertura de comunas
//
// ENCUADRE: solo fuentes legítimamente gratuitas — descarga oficial de
// autoservicio del SII, datasets abiertos bajo Ley 20.285, y servicios
// OGC/ArcGIS abiertos por diseño. NO evade auth/WAF ni scrapea sistemas
// protegidos. Objetivo NO comercial (señal interna de matching).
//
// Usa `curl` (no fetch/undici) para heredar el proxy del entorno, igual que
// scraper/lib/fetch.mjs. No requiere base de datos.
//
// USO:
//   node scraper/test-free-catastro-cl.mjs --probe
//   node scraper/test-free-catastro-cl.mjs --point -33.4013,-70.5713
//   node scraper/test-free-catastro-cl.mjs --comuna 15108
//   node scraper/test-free-catastro-cl.mjs --probe --json
// ─────────────────────────────────────────────────────────────────────────────
import { execFile } from 'node:child_process'
import { parseArgs } from 'node:util'

const TIMEOUT_S = 25

// ─── curl helpers (heredan HTTPS_PROXY del entorno) ──────────────────────────
function curl(url, { method = 'GET', maxTime = TIMEOUT_S } = {}) {
  return new Promise((resolve) => {
    const args = [
      '-s', '-S', '--max-time', String(maxTime),
      '-w', '\n__META__%{http_code}__%{time_total}',
      '-A', 'casafari-mio/test-free-catastro-cl (non-commercial matching signal)',
    ]
    if (method === 'HEAD') args.push('-I')
    args.push(url)
    const t0 = Date.now()
    execFile('curl', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout = '') => {
      const ms = Date.now() - t0
      const m = /\n__META__(\d+)__([\d.]+)$/.exec(stdout)
      const status = m ? Number(m[1]) : 0
      const body = m ? stdout.slice(0, m.index) : stdout
      resolve({ ok: status >= 200 && status < 400, status, ms, body, err: err?.message || null })
    })
  })
}

async function curlJson(url, opts) {
  const r = await curl(url, opts)
  let json = null
  try { json = JSON.parse(r.body) } catch { /* no era JSON */ }
  return { ...r, json }
}

// ─── Registro de fuentes gratuitas ───────────────────────────────────────────
// kind: 'arcgis' (consulta espacial programática) | 'manual' (descarga por
// navegador) | 'ogc' (WMS/WFS) . fills: huecos que cubre.
const SOURCES = [
  {
    id: 'sii-autoservicio',
    name: 'SII · Descarga Información Vigente por Comuna (oficial)',
    kind: 'manual',
    fills: ['base G3 (rol/dirección/superficie/destino)'],
    access: 'descarga manual del botón oficial (ya es el pipeline de sii_roles_cl)',
    legal: 'uso "personal y no comercial" → señal interna',
    probeUrl: 'https://www.sii.cl/servicios_online/1044-.html',
  },
  {
    id: 'catastral-cl',
    name: 'catastral.cl (Tremen) · polígonos + coords + ROL, 342 comunas',
    kind: 'manual',
    fills: ['G1', 'G2', 'G4'],
    access: 'descarga manual por navegador (bloquea acceso programático 403)',
    legal: 'derivado de info pública Ley 20.285; open-source',
    probeUrl: 'https://catastral.cl/',
  },
  {
    id: 'ciren-propiedades-rurales',
    name: 'CIREN · IDEMINAGRI/PROPIEDADES_RURALES (ArcGIS REST, campo rol)',
    kind: 'arcgis',
    fills: ['G1 (rural)', 'G2 (rural)'],
    access: 'ArcGIS REST — consulta espacial por punto/comuna (programático)',
    legal: 'servicio público estatal, abierto por diseño',
    probeUrl:
      'https://esri.ciren.cl/server/rest/services/IDEMINAGRI/PROPIEDADES_RURALES/MapServer?f=json',
    // capas por región; se descubren en runtime desde el MapServer
    mapServer:
      'https://esri.ciren.cl/server/rest/services/IDEMINAGRI/PROPIEDADES_RURALES/MapServer',
  },
  {
    id: 'ide-minvu',
    name: 'IDE MINVU · Geoportal Open Data (capa Predios donde exista)',
    kind: 'ogc',
    fills: ['G1 (urbano, cobertura parcial)'],
    access: 'ArcGIS Hub / WMS-WFS',
    legal: 'IDE nacional, datos abiertos',
    probeUrl: 'https://ide.minvu.cl/',
  },
]

// ─── Probe: ¿está arriba cada fuente? ────────────────────────────────────────
async function probeAll() {
  const results = []
  for (const s of SOURCES) {
    const r = await curl(s.probeUrl, { method: s.kind === 'arcgis' ? 'GET' : 'HEAD' })
    // ArcGIS a veces responde 200 con un JSON de error interno: detectarlo.
    let realOk = r.ok
    let note = ''
    if (s.kind === 'arcgis' && r.ok) {
      try {
        const j = JSON.parse(r.body)
        if (j.status === 'error' || j.error) {
          realOk = false
          note = 'HTTP ok pero el servidor ArcGIS devolvió error (probable caída transitoria)'
        }
      } catch { /* respuesta no-JSON, se acepta */ }
    }
    results.push({
      id: s.id, name: s.name, kind: s.kind, fills: s.fills,
      access: s.access, legal: s.legal,
      up: realOk, status: r.status, ms: r.ms, note: note || r.err || '',
    })
  }
  return results
}

// ─── Resolución por punto contra CIREN (point-in-polygon real) ──────────────
async function resolvePointCiren(lat, lng) {
  const src = SOURCES.find((s) => s.id === 'ciren-propiedades-rurales')
  const meta = await curlJson(`${src.mapServer}?f=json`)
  if (!meta.json || meta.json.error || meta.json.status === 'error') {
    return { source: 'ciren', ok: false, reason: 'MapServer no disponible ahora', raw: meta.status }
  }
  const layers = (meta.json.layers || []).filter((l) => !l.subLayerIds)
  const envelope = {
    xmin: lng - 0.01, ymin: lat - 0.01, xmax: lng + 0.01, ymax: lat + 0.01,
    spatialReference: { wkid: 4326 },
  }
  for (const layer of layers) {
    const qs = new URLSearchParams({
      geometry: JSON.stringify(envelope),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
      outFields: '*', returnGeometry: 'true', outSR: '4326',
      resultRecordCount: '3', f: 'json',
    })
    const q = await curlJson(`${src.mapServer}/${layer.id}/query?${qs}`)
    const feats = q.json?.features || []
    if (feats.length) {
      const attrs = feats[0].attributes || {}
      const rolKey = Object.keys(attrs).find((k) => /rol/i.test(k))
      return {
        source: 'ciren', ok: true, layer: layer.name, layerId: layer.id,
        matches: feats.length,
        rol: rolKey ? attrs[rolKey] : null,
        attributesSample: Object.fromEntries(Object.entries(attrs).slice(0, 8)),
        hasGeometry: Boolean(feats[0].geometry),
      }
    }
  }
  return { source: 'ciren', ok: false, reason: 'sin predio rural en el radio (punto probablemente urbano)' }
}

// ─── Comuna en catastral.cl ─────────────────────────────────────────────────
async function checkComunaCatastral(code) {
  // catastral.cl sirve una SPA; los datos se descargan a mano. Comprobamos que
  // la comuna existe en el visor por calles (street.catastral.cl responde por comuna).
  const r = await curl('https://catastral.cl/', { method: 'HEAD' })
  return {
    source: 'catastral.cl', comuna: code, siteUp: r.ok, status: r.status,
    note: 'Datos por comuna se descargan MANUALMENTE (GeoParquet/CSV) desde el visor; ' +
          'no hay endpoint JSON programático. Cargar en cadastre_parcels_cl con ogr2ogr.',
  }
}

// ─── Reporte ─────────────────────────────────────────────────────────────────
function printProbe(results, json) {
  if (json) { console.log(JSON.stringify(results, null, 2)); return }
  console.log('\n═══ Fuentes gratuitas para matching catastral CL ═══\n')
  for (const r of results) {
    const flag = r.up ? '🟢 ARRIBA' : '🔴 no disp.'
    console.log(`${flag}  [${r.kind}] ${r.name}`)
    console.log(`         cubre: ${r.fills.join(', ')}`)
    console.log(`         acceso: ${r.access}`)
    console.log(`         legal: ${r.legal}`)
    console.log(`         http=${r.status} ${r.ms}ms${r.note ? '  · ' + r.note : ''}\n`)
  }
  // Cobertura por hueco crítico
  const covers = (g) => results.some((r) => r.up && r.fills.some((f) => f.includes(g)))
  const g1 = covers('G1'), g2 = covers('G2')
  console.log('── Cobertura de huecos críticos ──')
  console.log(`   G1 (geometría predial / point-in-polygon): ${g1 ? '✅ hay fuente arriba' : '❌ ninguna disponible ahora'}`)
  console.log(`   G2 (coordenada por ROL):                   ${g2 ? '✅ hay fuente arriba' : '❌ ninguna disponible ahora'}`)
  console.log('')
  return g1 && g2
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const { values } = parseArgs({
    options: {
      probe: { type: 'boolean', default: false },
      point: { type: 'string' },
      comuna: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    strict: false,
  })

  // por defecto: probe
  const doProbe = values.probe || (!values.point && !values.comuna)

  let critOk = true

  if (doProbe) {
    const results = await probeAll()
    const ok = printProbe(results, values.json)
    if (ok === false) critOk = false
  }

  if (values.point) {
    const [lat, lng] = values.point.split(',').map((n) => Number(n.trim()))
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      console.error('--point espera "lat,lng" (ej. -33.4013,-70.5713)')
      process.exit(2)
    }
    const res = await resolvePointCiren(lat, lng)
    if (values.json) console.log(JSON.stringify(res, null, 2))
    else {
      console.log(`\n═══ Resolución point-in-polygon (${lat}, ${lng}) ═══\n`)
      if (res.ok) {
        console.log(`🟢 CIREN capa "${res.layer}" (id ${res.layerId}) → ${res.matches} predio(s)`)
        console.log(`   ROL SII: ${res.rol ?? '(sin campo rol en esta capa)'}`)
        console.log(`   geometría: ${res.hasGeometry ? 'sí (polígono)' : 'no'}`)
        console.log(`   attrs: ${JSON.stringify(res.attributesSample)}\n`)
      } else {
        console.log(`⚪ CIREN sin resultado: ${res.reason}`)
        console.log('   (CIREN cubre RURAL; para urbano usar catastral.cl — descarga manual)\n')
      }
    }
  }

  if (values.comuna) {
    const res = await checkComunaCatastral(values.comuna)
    if (values.json) console.log(JSON.stringify(res, null, 2))
    else {
      console.log(`\n═══ Comuna ${values.comuna} en catastral.cl ═══\n`)
      console.log(`   sitio: ${res.siteUp ? '🟢 arriba' : '🔴 caído'} (http=${res.status})`)
      console.log(`   ${res.note}\n`)
    }
  }

  process.exit(critOk ? 0 : 1)
}

main().catch((e) => { console.error('error:', e); process.exit(2) })
