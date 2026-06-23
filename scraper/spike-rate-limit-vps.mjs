#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// spike-rate-limit-vps.mjs
//
// Orquestador de Fase 0.5: validar rate-limit en VPS real midiendo con
// concurrencia escalada (1 → 2 → 3 → 5) sin proxy.
//
// Reutiliza spike-test-portalinmobiliario.mjs (que ya tiene todos los flags CLI).
// Ejecuta 4 spikes secuenciales contra el mismo set de IDs para comparabilidad.
//
// Decisión basada en resultados:
// - conc 5 sin 429: no necesita proxy (costo $0)
// - conc 5 con >20% 429: activar Geonode (~$13-47/mes)
// - conc 3 OK, conc 5 falla: usar conc ≤3 en Fase 2
// - 403 persistente: investigar WAF (Capsolver fallback)
//
// Uso:
//   node spike-rate-limit-vps.mjs [--ids MLC-X,MLC-Y,...]
//
// Si no pasas --ids, usa un set default de 20 IDs Vitacura reales.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return def
  const next = process.argv[i + 1]
  return next && !next.startsWith('--') ? next : true
}

const IDS = arg('ids') || [
  'MLC-1847000513', 'MLC-1847000514', 'MLC-1847000515', 'MLC-1847000516',
  'MLC-1847000517', 'MLC-1847000518', 'MLC-1847000519', 'MLC-1847000520',
  'MLC-1847000521', 'MLC-1847000522', 'MLC-1847000523', 'MLC-1847000524',
  'MLC-1847000525', 'MLC-1847000526', 'MLC-1847000527', 'MLC-1847000528',
  'MLC-1847000529', 'MLC-1847000530', 'MLC-1847000531', 'MLC-1847000532',
].join(',')

const OUT_DIR = './spike-results'
mkdirSync(OUT_DIR, { recursive: true })

const SPIKES = [
  { concurrency: 1, delay: 1500, label: 'baseline (conc 1, delay 1500)' },
  { concurrency: 2, delay: 1000, label: 'moderate (conc 2, delay 1000)' },
  { concurrency: 3, delay: 500, label: 'elevated (conc 3, delay 500)' },
  { concurrency: 5, delay: 0, label: 'stress test (conc 5, delay 0)' },
]

async function runSpike(spike, index) {
  return new Promise((resolve) => {
    const outDir = join(OUT_DIR, `spike-${index}-conc${spike.concurrency}`)
    const cmd = 'node'
    const args = [
      'spike-test-portalinmobiliario.mjs',
      `--ids`, IDS,
      `--count`, '20',
      `--concurrency`, String(spike.concurrency),
      `--delay`, String(spike.delay),
      `--no-proxy`,
      `--out`, outDir,
    ]

    console.log(`\n${'='.repeat(80)}`)
    console.log(`SPIKE ${index}/4: ${spike.label}`)
    console.log(`${cmd} ${args.join(' ')}`)
    console.log(`${'='.repeat(80)}\n`)

    const proc = spawn(cmd, args, { stdio: 'inherit' })
    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(`\n⚠️  Spike ${index} salió con código ${code} — continuando de todas formas\n`)
      }
      resolve()
    })
  })
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                   Fase 0.5: Rate-Limit Spike Test (VPS)                   ║
║         Midiendo Portal Inmobiliario con concurrencia escalada             ║
╚════════════════════════════════════════════════════════════════════════════╝

IDs a probar: ${IDS.split(',').length} fichas
Sin proxy: --no-proxy activo (validar sin dependencias de proxy)
Output: ${OUT_DIR}/spike-N-concX/_summary.json (métricas por spike)

La métrica clave es % de respuestas 429 (rate-limit) por concurrencia:
- 0% en conc 5 → proxy NO necesario (costo $0)
- >20% en conc 5 → proxy NECESARIO (Geonode ~$13-47/mes)

Ejecutando spikes secuencialmente...
`)

  for (let i = 0; i < SPIKES.length; i++) {
    await runSpike(SPIKES[i], i + 1)
  }

  console.log(`
${'='.repeat(80)}
Spikes completados. Resultados guardados en: ${OUT_DIR}/

Próximo paso: analizar _summary.json de cada spike:
  - Buscar "Status codes de fallos:"
  - Contar % de 429 vs 200 por spike
  - Decidir si necesita proxy basándose en tabla del plan

${'='.repeat(80)}
`)
}

main().catch((err) => {
  console.error('✗ Error:', err)
  process.exit(1)
})
