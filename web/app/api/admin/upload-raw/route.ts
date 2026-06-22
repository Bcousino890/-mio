import { NextRequest, NextResponse } from 'next/server'
import { mkdir, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { randomBytes } from 'node:crypto'

export const runtime = 'nodejs'

const UPLOAD_DIR = '/data/uploads'
const MAX_FILE_BYTES = 50 * 1024 * 1024 * 1024 // 50GB

export async function POST(request: NextRequest) {
  try {
    await mkdir(UPLOAD_DIR, { recursive: true })

    const formData = await request.formData()
    const files = formData.getAll('files') as File[]

    if (!files || files.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No files provided' },
        { status: 400 }
      )
    }

    const uploadedFiles: Array<{ name: string; path: string; size: number }> = []

    for (const file of files) {
      const bytes = await file.arrayBuffer()
      if (bytes.byteLength > MAX_FILE_BYTES) {
        return NextResponse.json(
          { success: false, error: `File ${file.name} exceeds ${MAX_FILE_BYTES / 1024 / 1024 / 1024}GB limit` },
          { status: 400 }
        )
      }

      // Generate unique filename: timestamp_random_originalname
      const timestamp = Date.now()
      const random = randomBytes(4).toString('hex')
      const ext = extname(file.name)
      const baseName = file.name.replace(ext, '').replace(/[^a-z0-9_-]/gi, '-')
      const filename = `${timestamp}_${random}_${baseName}${ext}`
      const filePath = `${UPLOAD_DIR}/${filename}`

      await writeFile(filePath, Buffer.from(bytes))
      uploadedFiles.push({
        name: file.name,
        path: filePath,
        size: bytes.byteLength,
      })
    }

    return NextResponse.json({
      success: true,
      files: uploadedFiles,
      message: `${uploadedFiles.length} file(s) uploaded successfully. They will be processed asynchronously.`,
    })
  } catch (error) {
    console.error('Error in upload-raw:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    )
  }
}
