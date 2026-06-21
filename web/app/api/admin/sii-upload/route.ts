import { NextRequest, NextResponse } from 'next/server'
import { mkdtemp, rm, mkdir, readdir, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import Busboy from 'busboy'
import { ingestSiiCatastroComuna, type SiiIngestFiles } from '@/lib/sii-catastro-ingest'

const execFileAsync = promisify(execFile)

export const runtime = 'nodejs'

const MAX_FILES = 10
const MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024 // 10GiB por archivo
const MAX_TOTAL_BYTES = 20 * 1024 * 1024 * 1024 // 20GiB agregados por subida (limitado por disco real del VPS)

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

function sanitizeBaseName(name: string): string {
  // path.basename ya evita "../", pero el nombre puede traer separadores de
  // Windows si el zip se generó ahí.
  return name.split(/[\\/]/).pop() ?? name
}

interface UploadedFile {
  name: string
  path: string
}

interface ParsedUpload {
  files: UploadedFile[]
  comunaId: string | null
}

// Parsea el multipart en streaming, escribiendo cada archivo directo a disco
// (sin bufferizarlo en memoria) — necesario para soportar archivos de hasta
// MAX_FILE_BYTES sin reventar la heap de Node.
async function parseMultipart(request: NextRequest, workDir: string): Promise<ParsedUpload> {
  const contentType = request.headers.get('content-type') ?? undefined
  const body = request.body
  if (!body) throw new Error('Solicitud sin cuerpo')

  return new Promise<ParsedUpload>((resolve, reject) => {
    const busboy = Busboy({
      headers: { 'content-type': contentType ?? '' },
      limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES },
    })

    const files: UploadedFile[] = []
    let comunaId: string | null = null
    let totalBytes = 0
    let fileCounter = 0
    let aborted = false
    const pendingWrites: Promise<void>[] = []

    function fail(err: Error) {
      if (aborted) return
      aborted = true
      busboy.destroy()
      reject(err)
    }

    busboy.on('field', (fieldname, value) => {
      if (fieldname === 'comunaId') comunaId = value
    })

    busboy.on('file', (_fieldname, fileStream, info) => {
      fileCounter += 1
      const destName = `upload-${fileCounter}-${sanitizeBaseName(info.filename || `archivo-${fileCounter}`)}`
      const destPath = join(workDir, destName)

      fileStream.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length
        if (totalBytes > MAX_TOTAL_BYTES) {
          fail(new Error(`Tamaño total excede ${MAX_TOTAL_BYTES / 1024 / 1024 / 1024}GB`))
        }
      })

      fileStream.on('limit', () => {
        fail(new Error(`El archivo ${info.filename} excede el límite de ${MAX_FILE_BYTES / 1024 / 1024 / 1024}GB`))
      })

      const writeStream = createWriteStream(destPath)
      const writePromise = pipeline(fileStream, writeStream)
        .then(() => {
          files.push({ name: sanitizeBaseName(info.filename || destName), path: destPath })
        })
        .catch((err) => {
          if (!aborted) fail(err instanceof Error ? err : new Error(String(err)))
        })
      pendingWrites.push(writePromise)
    })

    busboy.on('filesLimit', () => {
      fail(new Error(`Máximo ${MAX_FILES} archivos por subida`))
    })

    busboy.on('error', (err) => {
      fail(err instanceof Error ? err : new Error(String(err)))
    })

    busboy.on('finish', () => {
      if (aborted) return
      Promise.all(pendingWrites)
        .then(() => resolve({ files, comunaId }))
        .catch((err) => fail(err instanceof Error ? err : new Error(String(err))))
    })

    Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>).pipe(busboy)
  })
}

// Extrae un .zip a disco usando el binario `unzip` del sistema en vez de una
// librería JS en memoria — evita bufferizar el zip completo y, con -j
// (junk paths), elimina cualquier riesgo de zip-slip ya que aplana todas las
// entradas al destino sin reconstruir rutas.
async function extractZip(zipPath: string, destDir: string): Promise<UploadedFile[]> {
  await mkdir(destDir, { recursive: true })
  await execFileAsync('unzip', ['-o', '-q', '-j', zipPath, '-d', destDir])

  const entries: UploadedFile[] = []
  for (const name of await readdir(destDir)) {
    const path = join(destDir, name)
    const info = await stat(path)
    if (!info.isFile()) continue
    if (info.size > MAX_FILE_BYTES) {
      throw new Error(`Archivo ${name} dentro del zip excede el límite de ${MAX_FILE_BYTES / 1024 / 1024 / 1024}GB`)
    }
    entries.push({ name: sanitizeBaseName(name), path })
  }
  return entries
}

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ success: false, error: 'Configuración de base de datos no disponible' }, { status: 500 })
  }

  let workDir: string | null = null
  try {
    workDir = await mkdtemp(join(tmpdir(), 'sii-upload-'))

    const { files: uploaded, comunaId: _comunaId } = await parseMultipart(request, workDir)

    if (uploaded.length === 0) {
      return NextResponse.json({ success: false, error: 'No se recibió ningún archivo' }, { status: 400 })
    }

    const zipExtractDir = join(workDir, 'zip-extract')
    const entries: UploadedFile[] = []
    for (const file of uploaded) {
      if (file.name.toLowerCase().endsWith('.zip')) {
        entries.push(...(await extractZip(file.path, zipExtractDir)))
      } else {
        entries.push(file)
      }
    }

    const skipped: string[] = []
    const results: any[] = []

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
      filePorComuna[fileComunaCode][role] = entry.path
    }

    if (Object.keys(filePorComuna).length === 0) {
      return NextResponse.json(
        { success: false, error: 'Ningún archivo con formato reconocido', skipped },
        { status: 400 }
      )
    }

    // Procesar cada comuna según su código (identificado automáticamente del filename)
    // Continuar incluso si una comuna falla, para procesar el resto
    for (const [comunaCode, files] of Object.entries(filePorComuna)) {
      try {
        const result = await ingestSiiCatastroComuna({
          comunaCode,
          files: files as SiiIngestFiles,
          dbUrl: process.env.DATABASE_URL,
        })
        results.push({ comunaCode, ...result })
      } catch (err) {
        console.error(`Error procesando comuna ${comunaCode}:`, err)
        results.push({
          comunaCode,
          ok: false,
          counts: {},
          error: err instanceof Error ? err.message : 'Error al procesar',
        })
      }
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
