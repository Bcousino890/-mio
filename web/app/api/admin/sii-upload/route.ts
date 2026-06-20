import { NextRequest, NextResponse } from 'next/server'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { ingestSiiCatastroComuna, type SiiIngestFiles } from '@/lib/sii-catastro-ingest'

export const runtime = 'nodejs'

// Nombres oficiales de los 5 archivos planos del SII (ver glosarios
// "Estructura de archivo para Detalle Catastral / Rol de Cobro" en
// sii.cl → Descarga de Información Vigente por Comuna). Siempre terminan en
// "_<año>_<semestre>_<códigoComuna>", con o sin extensión.
const FILE_KIND_TO_ROLE: Record<string, keyof SiiIngestFiles> = {
  BRTMPCATASN: 'rolesNoAgricolas',
  BRTMPCATASNL: 'construccionesNoAgricolas',
  BRTMPCATASA: 'rolesAgricolas',
  BRTMPCATASAL: 'suelosConstruccionesAgricolas',
  BRTMPROLSEM: 'rolDeCobro',
}
// Orden con los prefijos más largos primero (BRTMPCATASNL antes de
// BRTMPCATASN, BRTMPCATASAL antes de BRTMPCATASA) para que el regex no
// matchee el prefijo corto por error.
const KIND_PATTERN = Object.keys(FILE_KIND_TO_ROLE).sort((a, b) => b.length - a.length).join('|')
const FILENAME_RE = new RegExp(`^(${KIND_PATTERN})_(\\d+)_(\\d+)_(\\d+)$`, 'i')

const MAX_ENTRY_BYTES = 200 * 1024 * 1024 // tope por archivo individual (post-descompresión) — anti zip-bomb

interface RawEntry {
  name: string
  buffer: Buffer
}

function sanitizeBaseName(name: string): string {
  // path.basename ya evita "../", pero el nombre puede traer separadores de
  // Windows si el zip se generó ahí.
  return name.split(/[\\/]/).pop() ?? name
}

async function extractZipEntries(buffer: Buffer): Promise<RawEntry[]> {
  const zip = await JSZip.loadAsync(buffer)
  const entries: RawEntry[] = []
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    const content = await entry.async('nodebuffer')
    if (content.byteLength > MAX_ENTRY_BYTES) {
      throw new Error(`Archivo ${name} dentro del zip excede el límite de ${MAX_ENTRY_BYTES / 1024 / 1024}MB`)
    }
    entries.push({ name: sanitizeBaseName(name), buffer: content })
  }
  return entries
}

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const uploaded = formData.getAll('files').filter((f): f is File => f instanceof File)

  if (uploaded.length === 0) {
    return NextResponse.json({ success: false, error: 'No se recibió ningún archivo' }, { status: 400 })
  }

  let workDir: string | null = null
  try {
    const entries: RawEntry[] = []
    for (const file of uploaded) {
      const name = sanitizeBaseName(file.name)
      const buffer = Buffer.from(await file.arrayBuffer())
      if (name.toLowerCase().endsWith('.zip')) {
        entries.push(...(await extractZipEntries(buffer)))
      } else {
        entries.push({ name, buffer })
      }
    }

    // Agrupa por comuna a partir del nombre de archivo (el SII codifica
    // comuna/año/semestre en el nombre — no hace falta pedírselo al usuario).
    const byComuna = new Map<string, { files: SiiIngestFiles; paths: string[] }>()
    const skipped: string[] = []

    workDir = await mkdtemp(join(tmpdir(), 'sii-upload-'))

    for (const entry of entries) {
      const base = entry.name.replace(/\.[^.]+$/, '')
      const match = base.match(FILENAME_RE)
      if (!match) {
        skipped.push(entry.name)
        continue
      }
      const kind = match[1].toUpperCase()
      const comunaCode = match[4]
      const role = FILE_KIND_TO_ROLE[kind]

      const destPath = join(workDir, `${comunaCode}_${entry.name}`)
      await writeFile(destPath, entry.buffer)

      if (!byComuna.has(comunaCode)) byComuna.set(comunaCode, { files: {}, paths: [] })
      const group = byComuna.get(comunaCode)!
      group.files[role] = destPath
      group.paths.push(destPath)
    }

    if (byComuna.size === 0) {
      return NextResponse.json(
        { success: false, error: 'Ningún archivo reconocido — se esperan los nombres oficiales del SII (BRTMPCATASN*, BRTMPROLSEM*, etc.)', skipped },
        { status: 400 }
      )
    }

    const results = []
    for (const [comunaCode, group] of byComuna) {
      const result = await ingestSiiCatastroComuna({ comunaCode, files: group.files })
      results.push({ comunaCode, ...result })
    }

    return NextResponse.json({ success: true, data: { results, skipped } })
  } catch (error) {
    console.error('Error en sii-upload:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error al procesar la subida' },
      { status: 500 }
    )
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true })
  }
}
