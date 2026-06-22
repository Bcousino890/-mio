import { NextRequest, NextResponse } from 'next/server'
import { mkdtemp, rm, readdir, open } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import Busboy from 'busboy'
import { createNdjsonEncoder } from '@/lib/sii-upload-stream'
import { ingestCatastralParquet } from '@/lib/catastral-parquet-ingest'

const execFileAsync = promisify(execFile)

export const runtime = 'nodejs'

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024 // 2GiB

async function isZip(path: string): Promise<boolean> {
  const fh = await open(path, 'r')
  try {
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(2), 0, 2, 0)
    return bytesRead === 2 && buffer[0] === 0x50 && buffer[1] === 0x4b // 'PK'
  } finally {
    await fh.close()
  }
}

async function extractZip(zipPath: string, destDir: string): Promise<string[]> {
  await execFileAsync('unzip', ['-o', '-q', '-j', zipPath, '-d', destDir])
  const names = await readdir(destDir)
  return names
    .filter((name) => name.toLowerCase().endsWith('.parquet') && !name.startsWith('._'))
    .sort()
}

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { success: false, error: 'Configuración de base de datos no disponible' },
      { status: 500 }
    )
  }

  const dbUrl = process.env.DATABASE_URL
  const encode = createNdjsonEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(obj: Record<string, unknown>) {
        controller.enqueue(encode(obj))
      }

      let workDir: string | null = null
      try {
        workDir = await mkdtemp(join(tmpdir(), 'catastral-parquet-'))
        const uploadPath = join(workDir, 'upload.bin')

        send({ phase: 'downloading' })

        // Parsear multipart y guardar el archivo
        const contentType = request.headers.get('content-type') ?? undefined
        const body = request.body
        if (!body) {
          throw new Error('Solicitud sin cuerpo')
        }

        let fileReceived = false
        const busboy = Busboy({
          headers: { 'content-type': contentType ?? '' },
          limits: { files: 1, fileSize: MAX_FILE_BYTES },
        })

        await new Promise<void>((resolve, reject) => {
          busboy.on('file', (_fieldname, fileStream, _info) => {
            fileReceived = true
            fileStream.pipe(createWriteStream(uploadPath))
            fileStream.on('end', resolve)
            fileStream.on('error', reject)
          })
          busboy.on('error', reject)
          Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>).pipe(
            busboy
          )
        })

        if (!fileReceived) {
          throw new Error('No se recibió ningún archivo')
        }

        send({ phase: 'downloaded' })

        let parquetPaths: string[]
        if (await isZip(uploadPath)) {
          const extractDir = join(workDir, 'extract')
          const names = await extractZip(uploadPath, extractDir)
          if (names.length === 0) {
            throw new Error('El .zip no contiene archivos .parquet')
          }
          parquetPaths = names.map((name) => join(extractDir, name))
        } else {
          parquetPaths = [uploadPath]
        }

        const results: Array<Record<string, unknown>> = []
        for (let i = 0; i < parquetPaths.length; i++) {
          const path = parquetPaths[i]
          const label =
            parquetPaths.length > 1
              ? (path.split('/').pop() ?? `archivo_${i + 1}`).replace(/\.parquet$/i, '')
              : 'catastral_parquet'
          send({ phase: 'processing', file: label, index: i + 1, total: parquetPaths.length })

          const result = await ingestCatastralParquet(path, dbUrl, (info) => {
            send({ progress: true, file: label, index: i + 1, total: parquetPaths.length, ...info })
          })
          results.push({ comunaCode: label, ok: result.ok, counts: result.counts, error: result.error })
          send({
            progress: true,
            comunaCode: label,
            status: result.ok ? 'ok' : 'error',
            counts: result.counts,
            error: result.error,
          })
        }

        send({
          done: true,
          success: results.some((r) => r.ok),
          data: { results, skipped: [] },
        })
      } catch (error) {
        console.error('Error en catastral-cl-parquet/from-file:', error)
        send({
          done: true,
          success: false,
          error: error instanceof Error ? error.message : 'Error al procesar',
        })
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
