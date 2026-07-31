#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ingest-sii-mapasui.mjs — Ingesta la salida JSONL de `scraper/sii-scraper/`
// (scraping automatizado de mapasFacadeService) en `sii_mapasui_predios_cl`.
//
// USO:
//   node scraper/ingest-sii-mapasui.mjs --dir sii-scraper/output/predios
//   node scraper/ingest-sii-mapasui.mjs --file sii-scraper/output/predios/vitacura.jsonl
//   node scraper/ingest-sii-mapasui.mjs --dir ... --full   # ignora checkpoints
//
// La ingesta es INCREMENTAL en dos niveles, uno barato y otro fino:
//   1. Atajo por mtime (solo --dir): si el .jsonl no cambió desde la última
//      corrida, ni se abre la BD. Cubre la comuna ya terminada.
//   2. Checkpoint por bytes en `sii_mapasui_ingest_state_cl` (migración 0090):
//      cuando el archivo SÍ creció, se leen solo los bytes nuevos en vez del
//      archivo entero. Esto es lo que hace barata la comuna en curso, que es
//      justo la que el atajo por mtime nunca puede saltarse.
// Con --full se ignoran ambos y se releen los archivos enteros (útil tras
// vaciar la tabla a mano).
//
// Requiere haber corrido antes, dentro de scraper/sii-scraper/:
//   python run.py manzanas --config config.json
//   python run.py predios  --config config.json
// (ver scraper/sii-scraper/README.md — incluye el aviso de procedencia/ToS)
// ─────────────────────────────────────────────────────────────────────────────
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { ingestMapasuiPrediosFile } from './lib/sii-mapasui-cl.mjs'

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    file: { type: 'string' },
    full: { type: 'boolean', default: false },
  },
})

async function main() {
  if (!values.dir && !values.file) {
    console.error('Uso: node ingest-sii-mapasui.mjs --dir <carpeta con .jsonl> | --file <archivo.jsonl> [--full]')
    process.exit(1)
  }

  const files = values.file
    ? [values.file]
    : (await readdir(values.dir))
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => join(values.dir, f))
        .sort()

  if (files.length === 0) {
    console.error('No se encontraron archivos .jsonl para ingestar.')
    process.exit(1)
  }

  const full = Boolean(values.full || process.env.SII_INGEST_FULL === '1')
  if (full) console.log('▶ Modo --full: se ignoran los checkpoints y se releen los archivos enteros.')

  const inicio = Date.now()
  let total = 0
  let fallos = 0
  for (const filePath of files) {
    // Modo --dir (cron recurrente): si el archivo no cambió desde la última
    // ingesta exitosa, saltarlo. Sin esto, un cron cada 30 min re-lee y
    // re-hace UPSERT fila por fila del .jsonl completo de una comuna que ya
    // terminó de scrapear hace tiempo, sin ningún dato nuevo que justifique
    // los minutos que tarda (ver .sii-mapasui-complete). Modo --file (uso
    // manual) siempre ingesta, sin este atajo.
    // `--full` tiene que saltarse este atajo: se pide justo cuando la tabla se
    // vació a mano, y ahí el archivo NO cambió pero sí hay que releerlo entero.
    const marker = `${filePath}.mtime`
    if (values.dir && !full) {
      const { mtimeMs } = await stat(filePath)
      const prevMtime = await readFile(marker, 'utf8').catch(() => null)
      if (prevMtime && Number(prevMtime) === mtimeMs) {
        console.log(`\n○ ${filePath} sin cambios desde la última ingesta — se omite.`)
        continue
      }
    }

    console.log(`\n→ Ingestando ${filePath}...`)
    const result = await ingestMapasuiPrediosFile({ filePath, full })
    if (!result.ok) {
      console.error(`  ✗ ${result.error}`)
      fallos++
      continue
    }
    total += result.count
    if (result.sinCambios) {
      console.log('  ✓ sin líneas nuevas (checkpoint al día)')
    } else {
      const invalidas = result.invalidas ? ` · ${result.invalidas} líneas ilegibles omitidas` : ''
      console.log(`  ✓ ${result.count} predios de ${result.lineas} líneas nuevas${invalidas}`)
    }
    if (values.dir) {
      const { mtimeMs } = await stat(filePath)
      await writeFile(marker, String(mtimeMs))
    }
  }

  const seg = ((Date.now() - inicio) / 1000).toFixed(1)
  console.log(`\nTotal ingestado: ${total} predios en sii_mapasui_predios_cl (${seg}s)`)
  // Salir con error si alguna ingesta falló (BD caída, JSONL corrupto...):
  // el cron de respaldo corre este script y un exit 0 con fallos dejaría el
  // workflow en verde mientras la BD se queda atrás en silencio.
  if (fallos > 0) {
    console.error(`✗ ${fallos} archivo(s) fallaron — saliendo con código 1`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
