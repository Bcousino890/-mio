#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ingest-sii-mapasui.mjs — Ingesta la salida JSONL de `scraper/sii-scraper/`
// (scraping automatizado de mapasFacadeService) en `sii_mapasui_predios_cl`.
//
// USO:
//   node scraper/ingest-sii-mapasui.mjs --dir sii-scraper/output/predios
//   node scraper/ingest-sii-mapasui.mjs --file sii-scraper/output/predios/vitacura.jsonl
//
// Requiere haber corrido antes, dentro de scraper/sii-scraper/:
//   python run.py manzanas --config config.json
//   python run.py predios  --config config.json
// (ver scraper/sii-scraper/README.md — incluye el aviso de procedencia/ToS)
// ─────────────────────────────────────────────────────────────────────────────
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { ingestMapasuiPrediosFile } from './lib/sii-mapasui-cl.mjs'

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    file: { type: 'string' },
  },
})

async function main() {
  if (!values.dir && !values.file) {
    console.error('Uso: node ingest-sii-mapasui.mjs --dir <carpeta con .jsonl> | --file <archivo.jsonl>')
    process.exit(1)
  }

  const files = values.file
    ? [values.file]
    : (await readdir(values.dir))
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => join(values.dir, f))

  if (files.length === 0) {
    console.error('No se encontraron archivos .jsonl para ingestar.')
    process.exit(1)
  }

  let total = 0
  for (const filePath of files) {
    console.log(`\n→ Ingestando ${filePath}...`)
    const result = await ingestMapasuiPrediosFile({ filePath })
    if (!result.ok) {
      console.error(`  ✗ ${result.error}`)
      continue
    }
    total += result.count
    console.log(`  ✓ ${result.count} predios`)
  }

  console.log(`\nTotal ingestado: ${total} predios en sii_mapasui_predios_cl`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
