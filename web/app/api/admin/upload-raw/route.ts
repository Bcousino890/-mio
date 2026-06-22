import { NextRequest, NextResponse } from 'next/server'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomBytes } from 'node:crypto'
import Busboy from 'busboy'

export const runtime = 'nodejs'

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/casafari-uploads'
const MAX_FILE_BYTES = 50 * 1024 * 1024 * 1024 // 50GB
const MAX_FILES = 10

function sanitize(name: string) {
  return name.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._\-]/g, '_') ?? 'file'
}

export async function POST(request: NextRequest) {
  try {
    await mkdir(UPLOAD_DIR, { recursive: true })
    const workDir = await mkdtemp(join(tmpdir(), 'upload-raw-'))

    const contentType = request.headers.get('content-type') ?? ''
    const uploadedFiles = await new Promise<Array<{ name: string; path: string; size: number }>>((resolve, reject) => {
      const busboy = Busboy({
        headers: { 'content-type': contentType },
        limits: { files: MAX_FILES, fileSize: MAX_FILE_BYTES },
      })
      const results: Array<{ name: string; path: string; size: number }> = []
      const writes: Promise<void>[] = []
      let aborted = false

      busboy.on('file', (_field, stream, info) => {
        const rand = randomBytes(4).toString('hex')
        const ext = extname(info.filename || 'file')
        const base = sanitize(info.filename || `file-${results.length + 1}`)
        const dest = join(UPLOAD_DIR, `${Date.now()}_${rand}_${base}`)
        const ws = createWriteStream(dest)
        let size = 0
        stream.on('data', (chunk: Buffer) => { size += chunk.length })
        writes.push(
          pipeline(stream, ws)
            .then(() => { results.push({ name: info.filename || base, path: dest, size }) })
            .catch((e) => { if (!aborted) { aborted = true; reject(e) } })
        )
      })
      busboy.on('filesLimit', () => reject(new Error(`Máximo ${MAX_FILES} archivos`)))
      busboy.on('finish', () => {
        if (!aborted) Promise.all(writes).then(() => resolve(results)).catch(reject)
      })
      busboy.on('error', reject)
      Readable.fromWeb(request.body as import('node:stream/web').ReadableStream<Uint8Array>).pipe(busboy)
    })

    return NextResponse.json({
      success: true,
      files: uploadedFiles,
      message: `${uploadedFiles.length} archivo(s) subido(s) correctamente.`,
    })
  } catch (error) {
    console.error('Error in upload-raw:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    )
  }
}
