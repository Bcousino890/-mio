import { NextRequest, NextResponse } from 'next/server'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createNdjsonEncoder, ingestGroupedFilesStreaming } from '@/lib/sii-upload-stream'
import type { SiiIngestFiles } from '@/lib/sii-catastro-ingest'

export const runtime = 'nodejs'

const MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024 // 10GiB

// Acepta tanto el link de compartir ("/file/d/<id>/view") como el de
// descarga directa ("?id=<id>").
function extractDriveFileId(url: string): string | null {
  const patterns = [/\/file\/d\/([a-zA-Z0-9_-]+)/, /[?&]id=([a-zA-Z0-9_-]+)/]
  for (const re of patterns) {
    const match = url.match(re)
    if (match) return match[1]
  }
  return null
}

// Descarga un archivo público de Google Drive al disco local sin pasar por
// el navegador del usuario. Para archivos >25MB, Drive intercala una página
// de confirmación ("no se puede analizar por virus") en vez del archivo —
// se intenta primero el endpoint moderno que la evita directamente, y si
// igual llega HTML se cae al flujo clásico de cookie + token `confirm=`.
async function downloadFromDrive(fileId: string, destPath: string): Promise<void> {
  const directUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`
  let res = await fetch(directUrl, { redirect: 'follow' })
  let contentType = res.headers.get('content-type') ?? ''

  if (!res.ok || contentType.includes('text/html')) {
    const firstUrl = `https://drive.google.com/uc?export=download&id=${fileId}`
    const first = await fetch(firstUrl, { redirect: 'follow' })
    const cookie = first.headers.get('set-cookie') ?? ''
    const firstBody = await first.text()
    const confirmMatch = firstBody.match(/confirm=([0-9A-Za-z_-]+)/)
    if (!confirmMatch) {
      throw new Error('No se pudo obtener el token de confirmación de Google Drive (¿el enlace es privado o no existe?)')
    }
    const confirmUrl = `https://drive.google.com/uc?export=download&confirm=${confirmMatch[1]}&id=${fileId}`
    res = await fetch(confirmUrl, { headers: cookie ? { cookie } : undefined, redirect: 'follow' })
    contentType = res.headers.get('content-type') ?? ''
    if (!res.ok) throw new Error(`Error descargando desde Google Drive (${res.status})`)
    if (contentType.includes('text/html')) {
      throw new Error('Google Drive devolvió una página HTML en vez del archivo (revisa que el enlace sea público)')
    }
  }

  if (!res.body) throw new Error('Respuesta de Google Drive sin cuerpo')
  await pipeline(
    Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>),
    createWriteStream(destPath)
  )
}

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
        console.error('Error en sii-upload/from-url:', error)
        send({ done: true, success: false, error: error instanceof Error ? error.message : 'Error al procesar la importación' })
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
