import { NextRequest, NextResponse } from 'next/server'
import { mkdtemp, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createNdjsonEncoder } from '@/lib/sii-upload-stream'
import { ingestCatastralParquet } from '@/lib/catastral-parquet-ingest'

export const runtime = 'nodejs'

const MAX_FILE_BYTES = 500 * 1024 * 1024 // 500MB

async function downloadFile(url: string, destPath: string): Promise<void> {
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
        const destPath = join(workDir, 'catastral_parquet.parquet')

        send({ phase: 'downloading' })
        await downloadFile(parquetUrl, destPath)
        send({ phase: 'downloaded' })

        const result = await ingestCatastralParquet(destPath, dbUrl, (info) => {
          send({ progress: true, ...info })
        })

        send({
          done: true,
          success: result.ok,
          data: { results: [{ ...result, component: 'catastral_parquet' }], skipped: [] },
          ...(result.error && { error: result.error }),
        })
      } catch (error) {
        console.error('Error en catastral-cl-parquet/from-url:', error)
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
