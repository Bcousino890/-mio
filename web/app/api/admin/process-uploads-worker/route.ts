import { NextRequest, NextResponse } from 'next/server'
import { readdir, stat, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { groupSiiFiles, ingestGroupedFilesStreaming } from '@/lib/sii-upload-stream'
import { ingestCatastralParquet } from '@/lib/catastral-parquet-ingest'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutos max

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/casafari-uploads'
const PROCESSED_DIR = join(UPLOAD_DIR, 'processed')
const FAILED_DIR = join(UPLOAD_DIR, 'failed')

function detectFileType(filename: string): 'sii' | 'parquet' | 'csv' | 'unknown' {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.parquet')) return 'parquet'
  if (lower.endsWith('.csv')) return 'csv'
  if (lower.endsWith('.zip')) {
    if (/BRTMP|catastro/i.test(filename)) return 'sii'
    return 'unknown'
  }
  if (/BRTMP|^catastro_/i.test(filename)) return 'sii'
  return 'unknown'
}

async function processSiiFiles(files: string[], dbUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const filePorComuna = groupSiiFiles(
      files.map((path) => ({ name: path.split('/').pop() || path, path }))
    ).filePorComuna

    if (Object.keys(filePorComuna).length === 0) {
      return { ok: false, error: 'No SII files recognized' }
    }

    const send = (obj: Record<string, unknown>) => {
      if (obj.done && !obj.success) throw new Error(obj.error as string)
    }

    await ingestGroupedFilesStreaming(filePorComuna, dbUrl, send)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Error processing SII' }
  }
}

async function processParquetFiles(files: string[], dbUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    for (const filePath of files) {
      await ingestCatastralParquet(filePath, dbUrl)
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Error processing Parquet' }
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { success: false, error: 'DATABASE_URL not configured' },
      { status: 500 }
    )
  }

  try {
    const dbUrl = process.env.DATABASE_URL
    let files: string[] = []

    try {
      const entries = await readdir(UPLOAD_DIR)
      files = entries
        .filter((f) => !f.startsWith('.') && f !== 'processed' && f !== 'failed')
        .map((f) => join(UPLOAD_DIR, f))

      const filtered = []
      for (const f of files) {
        const s = await stat(f)
        if (s.isFile()) filtered.push(f)
      }
      files = filtered
    } catch {
      files = []
    }

    if (files.length === 0) {
      return NextResponse.json({ success: true, message: 'No files to process', processed: 0 })
    }

    const siiFiles: string[] = []
    const parquetFiles: string[] = []
    let processed = 0

    // Classify files
    for (const filePath of files) {
      const filename = filePath.split('/').pop() || filePath
      const fileType = detectFileType(filename)

      if (fileType === 'sii' || fileType === 'unknown') siiFiles.push(filePath)
      else if (fileType === 'parquet') parquetFiles.push(filePath)
    }

    // Process SII files
    if (siiFiles.length > 0) {
      const result = await processSiiFiles(siiFiles, dbUrl)
      for (const filePath of siiFiles) {
        const filename = filePath.split('/').pop() || filePath
        const destDir = result.ok ? PROCESSED_DIR : FAILED_DIR
        try {
          await rename(filePath, join(destDir, filename))
          processed++
        } catch (err) {
          console.error(`Failed to move ${filename}:`, err)
        }
      }
    }

    // Process Parquet files
    if (parquetFiles.length > 0) {
      const result = await processParquetFiles(parquetFiles, dbUrl)
      for (const filePath of parquetFiles) {
        const filename = filePath.split('/').pop() || filePath
        const destDir = result.ok ? PROCESSED_DIR : FAILED_DIR
        try {
          await rename(filePath, join(destDir, filename))
          processed++
        } catch (err) {
          console.error(`Failed to move ${filename}:`, err)
        }
      }
    }

    return NextResponse.json({
      success: true,
      processed,
      message: `Processed ${processed} file(s)`,
    })
  } catch (error) {
    console.error('Worker error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Worker failed' },
      { status: 500 }
    )
  }
}
