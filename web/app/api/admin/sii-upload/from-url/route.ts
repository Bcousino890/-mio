import { NextRequest, NextResponse } from 'next/server'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNdjsonEncoder, ingestGroupedFilesStreaming } from '@/lib/sii-upload-stream'
import { extractDriveFileId, downloadFromDrive } from '@/lib/google-drive-download'
import type { SiiIngestFiles } from '@/lib/sii-catastro-ingest'

export const runtime = 'nodejs'

const MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024 // 10GiB

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ success: false, error: 'Configuración de base de datos no disponible' }, { status: 500 })
  }
  const dbUrl = process.env.DATABASE_URL

  let body: { driveUrl?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'JSON inválido' }, { status: 400 })
  }

  const driveUrl = body.driveUrl?.trim()
  if (!driveUrl) {
    return NextResponse.json({ success: false, error: 'driveUrl requerido' }, { status: 400 })
  }
  const fileId = extractDriveFileId(driveUrl)
  if (!fileId) {
    return NextResponse.json(
      { success: false, error: 'No se pudo extraer el ID de archivo del enlace de Google Drive' },
      { status: 400 }
    )
  }

  const encode = createNdjsonEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(obj: Record<string, unknown>) {
        controller.enqueue(encode(obj))
      }

      let workDir: string | null = null
      try {
        workDir = await mkdtemp(join(tmpdir(), 'sii-gdrive-'))
        const destPath = join(workDir, 'catastral_cl.csv')

        send({ phase: 'downloading' })
        await downloadFromDrive(fileId, destPath)

        const sizeBytes = (await stat(destPath)).size
        if (sizeBytes > MAX_FILE_BYTES) {
          throw new Error(`El archivo descargado excede el límite de ${MAX_FILE_BYTES / 1024 / 1024 / 1024}GB`)
        }
        send({ phase: 'downloaded' })

        // Este endpoint es exclusivo para el CSV nacional de catastral.cl —
        // a diferencia de la subida manual, no se intenta adivinar el tipo
        // de archivo por nombre (el Content-Disposition de Drive no es
        // confiable), se asume directamente.
        const filePorComuna: Record<string, Partial<SiiIngestFiles>> = {
          catastral_cl: { catastralCl: destPath },
        }

        const { results } = await ingestGroupedFilesStreaming(filePorComuna, dbUrl, send)
        send({ done: true, success: true, data: { results, skipped: [] } })
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error('Error en sii-upload/from-url:', errorMsg, error)
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
