import { NextRequest, NextResponse } from 'next/server'
import { readdir, stat, rename, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createNdjsonEncoder, groupSiiFiles } from '@/lib/sii-upload-stream'
import { ingestGroupedFilesStreaming } from '@/lib/sii-upload-stream'
import { ingestCatastralParquet } from '@/lib/catastral-parquet-ingest'

export const runtime = 'nodejs'

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/casafari-uploads'
const PROCESSED_DIR = join(UPLOAD_DIR, 'processed')
const FAILED_DIR = join(UPLOAD_DIR, 'failed')

interface ProcessedFile {
  filename: string
  type: 'sii' | 'parquet' | 'csv' | 'unknown'
  size: number
  status: 'success' | 'error' | 'pending'
  message?: string
}

function detectFileType(filename: string): 'sii' | 'parquet' | 'csv' | 'unknown' {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.parquet')) return 'parquet'
  if (lower.endsWith('.csv')) return 'csv'
  if (lower.endsWith('.zip')) {
    // Could be SII ZIP or Parquet ZIP — we'll try SII first
    if (/BRTMP|catastro/i.test(filename)) return 'sii'
    return 'unknown'
  }
  // Check if it matches SII filename pattern
  if (/BRTMP|^catastro_/i.test(filename)) return 'sii'
  return 'unknown'
}

async function processSiiFiles(files: string[], dbUrl: string): Promise<{ results: any[]; error?: string }> {
  try {
    const filePorComuna = groupSiiFiles(
      files.map((path) => ({ name: path.split('/').pop() || path, path }))
    ).filePorComuna

    if (Object.keys(filePorComuna).length === 0) {
      return { results: [], error: 'No SII files recognized in batch' }
    }

    const results: any[] = []
    const send = (obj: Record<string, unknown>) => {
      if (obj.done) {
        if (!obj.success) throw new Error(obj.error as string)
      } else if (obj.progress) {
        results.push(obj)
      }
    }

    await ingestGroupedFilesStreaming(filePorComuna, dbUrl, send)
    return { results }
  } catch (error) {
    return { results: [], error: error instanceof Error ? error.message : 'Error processing SII files' }
  }
}

async function processParquetFiles(files: string[], dbUrl: string): Promise<{ results: any[]; error?: string }> {
  try {
    const results: any[] = []
    for (const filePath of files) {
      try {
        const result = await ingestCatastralParquet(filePath, dbUrl, (info) => {
          results.push(info)
        })
        results.push(result)
      } catch (error) {
        results.push({
          error: error instanceof Error ? error.message : 'Error processing parquet',
          file: filePath,
        })
      }
    }
    return { results }
  } catch (error) {
    return { results: [], error: error instanceof Error ? error.message : 'Error processing Parquet files' }
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
    const uploadDir = UPLOAD_DIR
    await mkdir(PROCESSED_DIR, { recursive: true })
    await mkdir(FAILED_DIR, { recursive: true })

    // List all files in upload directory
    let files: string[] = []
    try {
      const entries = await readdir(uploadDir)
      files = entries
        .filter((f) => !f.startsWith('.') && f !== 'processed' && f !== 'failed')
        .map((f) => join(uploadDir, f))

      // Filter out directories
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
      return NextResponse.json({
        success: true,
        message: 'No files to process',
        processed: [],
      })
    }

    const processed: ProcessedFile[] = []
    const siiFiles: string[] = []
    const parquetFiles: string[] = []
    const csvFiles: string[] = []

    // Classify files
    for (const filePath of files) {
      const filename = filePath.split('/').pop() || filePath
      const fileType = detectFileType(filename)
      const fileSize = (await stat(filePath)).size

      if (fileType === 'sii') siiFiles.push(filePath)
      else if (fileType === 'parquet') parquetFiles.push(filePath)
      else if (fileType === 'csv') csvFiles.push(filePath)
      else {
        processed.push({
          filename,
          type: 'unknown',
          size: fileSize,
          status: 'pending',
          message: 'Unknown file type - will attempt SII processing',
        })
        siiFiles.push(filePath) // Try as SII
      }
    }

    // Process SII files
    if (siiFiles.length > 0) {
      const { results, error } = await processSiiFiles(siiFiles, dbUrl)
      for (const filePath of siiFiles) {
        const filename = filePath.split('/').pop() || filePath
        processed.push({
          filename,
          type: 'sii',
          size: (await stat(filePath)).size,
          status: error ? 'error' : 'success',
          message: error || `SII processed: ${JSON.stringify(results)}`,
        })
        // Move to processed/failed
        const destDir = error ? FAILED_DIR : PROCESSED_DIR
        try {
          await rename(filePath, join(destDir, filename))
        } catch {
          // Directory might not exist
        }
      }
    }

    // Process Parquet files
    if (parquetFiles.length > 0) {
      const { results, error } = await processParquetFiles(parquetFiles, dbUrl)
      for (const filePath of parquetFiles) {
        const filename = filePath.split('/').pop() || filePath
        processed.push({
          filename,
          type: 'parquet',
          size: (await stat(filePath)).size,
          status: error ? 'error' : 'success',
          message: error || `Parquet processed: ${JSON.stringify(results)}`,
        })
        // Move to processed/failed
        const destDir = error ? FAILED_DIR : PROCESSED_DIR
        try {
          await rename(filePath, join(destDir, filename))
        } catch {
          // Directory might not exist
        }
      }
    }

    return NextResponse.json({
      success: true,
      processed,
      summary: {
        total: processed.length,
        successful: processed.filter((p) => p.status === 'success').length,
        failed: processed.filter((p) => p.status === 'error').length,
      },
    })
  } catch (error) {
    console.error('Error in process-uploads:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Processing failed' },
      { status: 500 }
    )
  }
}
