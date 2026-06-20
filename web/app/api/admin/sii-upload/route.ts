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
  const comunaId = formData.get('comunaId') as string | null

  if (uploaded.length === 0) {
    return NextResponse.json({ success: false, error: 'No se recibió ningún archivo' }, { status: 400 })
  }

  if (!comunaId) {
    return NextResponse.json({ success: false, error: 'Debes seleccionar una comuna' }, { status: 400 })
  }

  let workDir: string | null = null
  try {
    // Obtén el código de comuna de la BD usando la UUID
    const comunaResult = await (await import('@/lib/db')).pool.query(
      'SELECT sii_comuna_code FROM chile_comunas WHERE id = $1',
      [comunaId]
    )

    if (comunaResult.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Comuna no encontrada' }, { status: 400 })
    }

    const comunaCode = comunaResult.rows[0].sii_comuna_code
    if (!comunaCode) {
      return NextResponse.json(
        { success: false, error: 'Esta comuna aún no tiene código SII asignado. Contacta al administrador.' },
        { status: 400 }
      )
    }

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

    const files: SiiIngestFiles = {}
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
      const fileComunaCode = match[4]

      // Valida que el archivo sea de la comuna seleccionada (opcional: warning si no coincide)
      if (fileComunaCode !== comunaCode) {
        skipped.push(`${entry.name} (comuna ${fileComunaCode} no coincide con seleccionada)`)
        continue
      }

      const role = FILE_KIND_TO_ROLE[kind]
      const destPath = join(workDir, entry.name)
      await writeFile(destPath, entry.buffer)
      files[role] = destPath
    }

    if (Object.keys(files).length === 0) {
      return NextResponse.json(
        { success: false, error: 'Ningún archivo reconocido para esta comuna', skipped },
        { status: 400 }
      )
    }

    const result = await ingestSiiCatastroComuna({ comunaCode, files })

    return NextResponse.json({ success: true, data: { results: [{ comunaCode, ...result }], skipped } })
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
