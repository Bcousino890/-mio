import { NextRequest, NextResponse } from 'next/server'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { Pool } from 'pg'
import { ingestSiiCatastroComuna, type SiiIngestFiles } from '@/lib/sii-catastro-ingest'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutos para procesar archivos grandes

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

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
  const comunaId = formData.get('comunaId') as string | null

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

    const skipped: string[] = []
    const results: any[] = []

    workDir = await mkdtemp(join(tmpdir(), 'sii-upload-'))

    // Agrupar archivos por código de comuna (extraído del filename)
    const filePorComuna: Record<string, { [key in keyof SiiIngestFiles]?: string }> = {}

    for (const entry of entries) {
      const base = entry.name.replace(/\.[^.]+$/, '')
      const match = base.match(FILENAME_RE)
      if (!match) {
        skipped.push(entry.name)
        continue
      }
      const kind = match[1].toUpperCase()
      const fileComunaCode = match[4]

      if (!filePorComuna[fileComunaCode]) {
        filePorComuna[fileComunaCode] = {}
      }

      const role = FILE_KIND_TO_ROLE[kind]
      const destPath = join(workDir, entry.name)
      await writeFile(destPath, entry.buffer)
      filePorComuna[fileComunaCode][role] = destPath
    }

    if (Object.keys(filePorComuna).length === 0) {
      return NextResponse.json(
        { success: false, error: 'Ningún archivo con formato reconocido', skipped },
        { status: 400 }
      )
    }

    // Procesar cada comuna según su código (identificado automáticamente del filename)
    for (const [comunaCode, files] of Object.entries(filePorComuna)) {
      const result = await ingestSiiCatastroComuna({ comunaCode, files: files as SiiIngestFiles })
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
