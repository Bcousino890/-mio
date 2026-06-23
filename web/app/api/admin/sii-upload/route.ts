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
import {
  groupSiiFiles,
  ingestGroupedFilesStreaming,
  createNdjsonEncoder,
  sanitizeBaseName,
  type UploadedFile,
} from '@/lib/sii-upload-stream'

const execFileAsync = promisify(execFile)

export const runtime = 'nodejs'

const MAX_FILES = 10
const MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024 // 10GiB por archivo
const MAX_TOTAL_BYTES = 20 * 1024 * 1024 * 1024 // 20GiB agregados por subida (limitado por disco real del VPS)

interface ParsedUpload {
  files: UploadedFile[]
  comunaId: string | null
}

// Parsea el multipart en streaming, escribiendo cada archivo directo a disco
// (sin bufferizarlo en memoria) — necesario para soportar archivos de hasta
// MAX_FILE_BYTES sin reventar la heap de Node. `onProgress` se invoca con el
// total de bytes recibidos hasta el momento, para poder reportar avance de
// la fase de subida antes de que termine de llegar el body completo.
async function parseMultipart(
  request: NextRequest,
  workDir: string,
  onProgress?: (loadedBytes: number) => void
): Promise<ParsedUpload> {
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
        onProgress?.(totalBytes)
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

  const dbUrl = process.env.DATABASE_URL
  const encode = createNdjsonEncoder()

  // Streaming real: el body de la respuesta se va escribiendo a medida que
  // avanza la subida y luego la ingesta, en vez de bufferizar todo y recién
  // responder al final (lo que dejaba al cliente sin ninguna señal de avance
  // durante los 30+ minutos que puede tardar una comuna grande o el CSV
  // nacional de catastral.cl).
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(obj: Record<string, unknown>) {
        controller.enqueue(encode(obj))
      }

      let workDir: string | null = null
      try {
        workDir = await mkdtemp(join(tmpdir(), 'sii-upload-'))

        const totalRequestBytes = Number(request.headers.get('content-length') ?? 0) || 0
        let lastUploadReportTime = 0
        const { files: uploaded } = await parseMultipart(request, workDir, (loadedBytes) => {
          if (!totalRequestBytes) return
          const now = Date.now()
          if (now - lastUploadReportTime < 500) return
          lastUploadReportTime = now
          send({ phase: 'uploading', loadedBytes, totalBytes: totalRequestBytes })
        })
        if (totalRequestBytes) {
          send({ phase: 'uploading', loadedBytes: totalRequestBytes, totalBytes: totalRequestBytes })
        }

        if (uploaded.length === 0) {
          send({ done: true, success: false, error: 'No se recibió ningún archivo' })
          return
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

        const { filePorComuna, skipped } = groupSiiFiles(entries)

        if (Object.keys(filePorComuna).length === 0) {
          send({ done: true, success: false, error: 'Ningún archivo con formato reconocido', data: { skipped } })
          return
        }

        const { results } = await ingestGroupedFilesStreaming(filePorComuna, dbUrl, send)
        send({ done: true, success: true, data: { results, skipped } })
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error('Error en sii-upload:', errorMsg, error)
        send({ done: true, success: false, error: errorMsg })
      } finally {
        if (workDir) await rm(workDir, { recursive: true, force: true })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
