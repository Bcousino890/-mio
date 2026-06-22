import { NextRequest, NextResponse } from 'next/server'
import { mkdtemp, rm, readdir, stat, open } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createNdjsonEncoder } from '@/lib/sii-upload-stream'
import { ingestCatastralParquet } from '@/lib/catastral-parquet-ingest'
import { extractDriveFileId, downloadFromDrive } from '@/lib/google-drive-download'

const execFileAsync = promisify(execFile)

export const runtime = 'nodejs'

// catastral.cl no permite descargar una comuna entera en un solo Parquet
// nacional — hay que bajar 346 archivos (uno por comuna) desde su tienda.
// En vez de pedirle al usuario que pegue 346 links de a uno, este endpoint
// también acepta un .zip con varios .parquet adentro: basta con seleccionar
// todos los archivos descargados en Google Drive y usar "Descargar" (Drive
// los comprime server-side) y pegar el link de ese .zip.
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024 // 2GiB

async function downloadDirect(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(`Error descargando archivo (HTTP ${res.status})`)
  }
  if (!res.body) {
    throw new Error('Respuesta sin cuerpo')
  }
  await pipeline(
    Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>),
    createWriteStream(destPath)
  )
}

async function isZip(path: string): Promise<boolean> {
  const fh = await open(path, 'r')
  try {
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(2), 0, 2, 0)
    return bytesRead === 2 && buffer[0] === 0x50 && buffer[1] === 0x4b // 'PK'
  } finally {
    await fh.close()
  }
}

// Igual que la extracción de zips de subida manual (sii-upload/route.ts):
// `unzip -j` aplana todas las entradas al destino, evitando reconstruir
// rutas (sin riesgo de zip-slip) y sin bufferizar el zip completo en memoria.
async function extractZip(zipPath: string, destDir: string): Promise<string[]> {
  await execFileAsync('unzip', ['-o', '-q', '-j', zipPath, '-d', destDir])
  const names = await readdir(destDir)
  // Zips creados desde macOS (Finder "Comprimir" o `zip` sin -X) incluyen un
  // "._NombreArchivo.parquet" por cada archivo real — metadata AppleDouble
  // (resource fork), no datos. No son Parquet válido: hay que descartarlos o
  // duplican el conteo de comunas y fallan al parsear.
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

  let body: { parquetUrl?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'JSON inválido' }, { status: 400 })
  }

  const parquetUrl = body.parquetUrl?.trim()
  if (!parquetUrl) {
    return NextResponse.json({ success: false, error: 'parquetUrl requerido' }, { status: 400 })
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(obj: Record<string, unknown>) {
        controller.enqueue(encode(obj))
      }

      let workDir: string | null = null
      try {
        workDir = await mkdtemp(join(tmpdir(), 'catastral-parquet-'))
        const downloadPath = join(workDir, 'download.bin')

        send({ phase: 'downloading' })
        const driveFileId = extractDriveFileId(parquetUrl)
        if (driveFileId) {
          await downloadFromDrive(driveFileId, downloadPath)
        } else {
          await downloadDirect(parquetUrl, downloadPath)
        }

        const sizeBytes = (await stat(downloadPath)).size
        if (sizeBytes > MAX_FILE_BYTES) {
          throw new Error(`El archivo descargado excede el límite de ${MAX_FILE_BYTES / 1024 / 1024 / 1024}GB`)
        }
        send({ phase: 'downloaded' })

        // ¿Es un .zip con varios .parquet (una comuna por archivo) o un
        // .parquet individual? Se detecta por la firma del archivo, no por
        // la URL — Drive no preserva la extensión en sus links de descarga.
        let parquetPaths: string[]
        if (await isZip(downloadPath)) {
          const extractDir = join(workDir, 'extract')
          const names = await extractZip(downloadPath, extractDir)
          if (names.length === 0) {
            throw new Error('El .zip no contiene archivos .parquet')
          }
          parquetPaths = names.map((name) => join(extractDir, name))
        } else {
          parquetPaths = [downloadPath]
        }

        const results: Array<Record<string, unknown>> = []
        for (let i = 0; i < parquetPaths.length; i++) {
          const path = parquetPaths[i]
          // Con varios archivos (zip), cada uno se etiqueta con su propio
          // nombre (ej. "Lo_Barnechea_15161") para distinguirlos en la UI.
          const label =
            parquetPaths.length > 1
              ? (path.split('/').pop() ?? `archivo_${i + 1}`).replace(/\.parquet$/i, '')
              : 'catastral_parquet'
          send({ phase: 'processing', file: label, index: i + 1, total: parquetPaths.length })

          const result = await ingestCatastralParquet(path, dbUrl, (info) => {
            send({ progress: true, file: label, index: i + 1, total: parquetPaths.length, ...info })
          })
          results.push({ comunaCode: label, ok: result.ok, counts: result.counts, error: result.error })
          // Mensaje de resumen por archivo — es el que la UI lee para poblar
          // la lista de resultados (msg.progress && msg.counts).
          send({ progress: true, comunaCode: label, status: result.ok ? 'ok' : 'error', counts: result.counts, error: result.error })
        }

        send({
          done: true,
          success: results.some((r) => r.ok),
          data: { results, skipped: [] },
        })
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error('Error en catastral-cl-parquet/from-url:', errorMsg, error)
        send({
          done: true,
          success: false,
          error: errorMsg,
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
