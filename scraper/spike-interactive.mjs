#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// spike-interactive.mjs
//
// Interactivo y fácil: no necesitas saber bash, solo responde las preguntas
// y el script ejecuta los spikes automáticamente.
// ─────────────────────────────────────────────────────────────────────────────

import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const readline = createInterface({
  input: process.stdin,
  output: process.stdout,
})

function question(q) {
  return new Promise((resolve) => {
    readline.question(q, resolve)
  })
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║         Fase 0.5: Rate-Limit Spike Test — Setup Interactivo              ║
║                                                                            ║
║  Sin terminal = sin problema. Responde estas preguntas y listo.           ║
╚════════════════════════════════════════════════════════════════════════════╝
`)

  const withProxy = await question(`
¿Quieres usar Smartproxy para esta spike? (s/n)
(s) = comparar WITH proxy; (n) = baseline SIN proxy
→ `)

  let smartproxyUrl = null
  if (withProxy.toLowerCase() === 's') {
    console.log(`
📋 Cómo obtener tu URL de API de Smartproxy:
  1. Entra a https://www.smartproxy.com/ (login)
  2. Proxies → Residential Proxy → Configuración de proxy
  3. Copia el "Enlace API generado"
  4. Pégalo abajo

Ej: https://api.smartproxy.com/web_v1/get-v3?app_key=9cf8476185ea51d90a811dfed197546pi
`)
    smartproxyUrl = await question('Pega tu Smartproxy URL aquí: ')
    if (!smartproxyUrl.includes('api.smartproxy')) {
      console.error('❌ URL no parece válida. Continuando sin proxy.')
      smartproxyUrl = null
    }
  }

  const customIds = await question(`
¿Quieres probar contra fichas específicas? (dejar en blanco = IDs default Vitacura)
Ej: MLC-1847000513,MLC-1847000514,MLC-1847000515
→ `)

  console.log(`
${'='.repeat(80)}
⚙️  CONFIGURACIÓN FINAL
${'='.repeat(80)}
Proxy: ${smartproxyUrl ? '✓ Smartproxy (rotación residencial)' : '✗ Sin proxy (baseline)'}
IDs: ${customIds ? `custom (${customIds.split(',').length} fichas)` : 'default Vitacura (20 fichas)'}
Concurrencia: escalada 1 → 2 → 3 → 5
Tiempo estimado: ~12-15 minutos

¡Iniciando spikes!
${'='.repeat(80)}
`)

  mkdirSync('./spike-results', { recursive: true })

  const args = ['scraper/spike-rate-limit-vps.mjs']
  if (customIds) args.push('--ids', customIds)

  const env = { ...process.env }
  if (smartproxyUrl) {
    env.SMARTPROXY_URL = smartproxyUrl
  }

  const proc = spawn('node', args, { stdio: 'inherit', env })
  proc.on('close', (code) => {
    if (code === 0) {
      console.log(`
${'='.repeat(80)}
✓ SPIKES COMPLETADOS
${'='.repeat(80)}

Resultados guardados en: ./spike-results/

Próximos pasos:
1. Analiza los JSONs de cada spike (spike-*/spike-N-concX/_summary.json)
2. Busca el % de respuestas 429 (rate-limit) en cada uno
3. Comparte los resultados para decidir si necesita proxy en Fase 2

Para compartir resultados conmigo:
  git add spike-results/
  git commit -m "spike(fase-0.5): resultados con/sin proxy"
  git push origin claude/laughing-tesla-8nqqc9
  (luego comenta en PR #52)
`)
    } else {
      console.error(`\n❌ Spikes fallaron con código ${code}`)
    }
    process.exit(code)
  })
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
