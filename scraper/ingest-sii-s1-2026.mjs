#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ingest-sii-s1-2026.mjs — Ingesta CSV oficial SII S1-2026 para una o varias
// comunas en sii_roles_cl.
//
// USO:
//   node scraper/ingest-sii-s1-2026.mjs --comuna 15108 --dir /data/sii/las-condes
//   node scraper/ingest-sii-s1-2026.mjs --all --dir /data/sii/
//
// ESTRUCTURA DE DIRECTORIOS ESPERADA (por cada comuna):
//   /data/sii/{comuna_code}/
//     BRTMPCATASN_*.txt   → roles no agrícolas (incluye lat/lon en S1-2026)
//     BRTMPCATASNL_*.txt  → construcciones no agrícolas
//     BRTMPCATASA_*.txt   → roles agrícolas
//     BRTMPCATASAL_*.txt  → suelos/construcciones agrícolas
//     RC_*.txt            → Rol de Cobro
//
// Si todos los archivos están en el mismo directorio plano (--dir):
//   el script detecta automáticamente por prefijo de nombre de archivo.
//
// DESCARGA PREVIA (manual):
//   1. Ir a sii.cl → Avalúos y Contribuciones → Descarga de Información Vigente
//   2. Seleccionar comuna → Descargar archivos planos S1-2026
//   3. Descomprimir en /data/sii/{comuna_code}/
// ─────────────────────────────────────────────────────────────────────────────
import { readdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { parseArgs } from 'node:util'
import { ingestSiiCatastroComuna } from './lib/sii-catastro-cl.mjs'

const COMUNAS_PRIORITARIAS = [
  '15131', // Vitacura
  '15108', // Las Condes
  '15111', // Lo Barnechea
  '13119', // Providencia
  '13120', // Ñuñoa
  '13106', // La Reina
  '13101', // Santiago
  '13301', // Colina
]

const { values: args } = parseArgs({
  options: {
    comuna:  { type: 'string' },
    dir:     { type: 'string' },
    all:     { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
  strict: false,
})

const DIR = args.dir ?? process.env.SII_DATA_DIR
if (!DIR) {
  console.error('ERROR: --dir <ruta> o SII_DATA_DIR requerido')
  process.exit(1)
}

async function detectFiles(comunaDir) {
  let entries
  try {
    entries = await readdir(comunaDir)
  } catch {
    return {}
  }
  const files = {}
  for (const name of entries) {
    const upper = name.toUpperCase()
    const path = join(comunaDir, name)
    if (upper.startsWith('BRTMPCATASN_') && !upper.includes('BRTMPCATASNL')) files.rolesNoAgricolas = path
    else if (upper.startsWith('BRTMPCATASNL')) files.construccionesNoAgricolas = path
    else if (upper.startsWith('BRTMPCATASA_') && !upper.includes('BRTMPCATASAL')) files.rolesAgricolas = path
    else if (upper.startsWith('BRTMPCATASAL')) files.suelosConstruccionesAgricolas = path
    else if (upper.startsWith('RC_') || upper.startsWith('ROL_COBRO') || upper.startsWith('BRTMPCOBRO')) files.rolDeCobro = path
  }
  return files
}

async function ingestComuna(comunaCode) {
  const comunaDir = join(DIR, comunaCode)
  const files = await detectFiles(comunaDir)

  if (Object.keys(files).length === 0) {
    // Intentar directorio plano (todos en DIR directamente)
    const flat = await detectFiles(DIR)
    if (Object.keys(flat).length > 0) {
      console.log(`[${comunaCode}] Usando directorio plano ${DIR}`)
      Object.assign(files, flat)
    }
  }

  if (Object.keys(files).length === 0) {
    console.warn(`[${comunaCode}] No se encontraron archivos en ${comunaDir} ni en ${DIR}`)
    return
  }

  console.log(`[${comunaCode}] Archivos detectados:`, Object.keys(files).join(', '))

  if (args['dry-run']) {
    console.log(`[${comunaCode}] --dry-run: no se ejecuta la ingesta`)
    return
  }

  const result = await ingestSiiCatastroComuna({ comunaCode, files })
  if (result.ok) {
    console.log(`[${comunaCode}] ✓ Ingesta completa:`, result.counts)
  } else {
    console.error(`[${comunaCode}] ✗ Error:`, result.error)
  }
}

async function main() {
  const comunas = args.all
    ? COMUNAS_PRIORITARIAS
    : args.comuna
      ? [args.comuna]
      : COMUNAS_PRIORITARIAS

  console.log(`Ingesta SII S1-2026 — ${comunas.length} comuna(s): ${comunas.join(', ')}`)
  for (const c of comunas) {
    await ingestComuna(c)
  }
  console.log('Ingesta finalizada.')
}

main().catch((err) => { console.error(err); process.exit(1) })
