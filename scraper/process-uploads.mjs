#!/usr/bin/env node
/**
 * Process uploaded files in /data/uploads
 * Usage: node process-uploads.mjs
 *
 * This script:
 * 1. Lists all files in /data/uploads
 * 2. Detects their type (SII, Parquet, CSV, etc.)
 * 3. Processes them according to their type
 * 4. Moves them to /data/uploads/processed or /data/uploads/failed
 */

import { readdir, stat, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const UPLOAD_DIR = '/data/uploads'
const PROCESSED_DIR = join(UPLOAD_DIR, 'processed')
const FAILED_DIR = join(UPLOAD_DIR, 'failed')

function detectFileType(filename) {
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

async function listFiles() {
  try {
    const entries = await readdir(UPLOAD_DIR)
    const files = []

    for (const entry of entries) {
      // Skip special directories and hidden files
      if (entry.startsWith('.') || entry === 'processed' || entry === 'failed') continue

      const fullPath = join(UPLOAD_DIR, entry)
      try {
        const s = await stat(fullPath)
        if (s.isFile()) {
          files.push({
            name: entry,
            path: fullPath,
            size: s.size,
            type: detectFileType(entry),
          })
        }
      } catch (err) {
        console.error(`Error stat'ing ${entry}:`, err.message)
      }
    }

    return files
  } catch (err) {
    console.error('Error reading upload directory:', err.message)
    return []
  }
}

async function processFiles(files) {
  // Ensure directories exist
  try {
    await mkdir(PROCESSED_DIR, { recursive: true })
    await mkdir(FAILED_DIR, { recursive: true })
  } catch (err) {
    console.error('Error creating directories:', err.message)
  }

  if (files.length === 0) {
    console.log('No files to process')
    return
  }

  console.log(`Found ${files.length} file(s) to process:`)
  files.forEach((f) => {
    console.log(`  - ${f.name} (${f.type}, ${(f.size / 1024 / 1024).toFixed(2)}MB)`)
  })

  // Group by type
  const byType = { sii: [], parquet: [], csv: [], unknown: [] }
  for (const f of files) {
    byType[f.type].push(f)
  }

  console.log('\nProcessing...')

  // Process each group
  for (const [type, typeFiles] of Object.entries(byType)) {
    if (typeFiles.length === 0) continue

    console.log(`\n${type.toUpperCase()} files (${typeFiles.length}):`)

    for (const file of typeFiles) {
      try {
        console.log(`  Processing: ${file.name}...`)
        // TODO: Integrate with actual ingestion logic
        // For now, just move to processed
        const destPath = join(PROCESSED_DIR, file.name)
        await rename(file.path, destPath)
        console.log(`    ✓ Moved to processed`)
      } catch (err) {
        console.error(`    ✗ Error: ${err.message}`)
        try {
          const destPath = join(FAILED_DIR, file.name)
          await rename(file.path, destPath)
          console.log(`    ✓ Moved to failed`)
        } catch (moveErr) {
          console.error(`    ✗ Could not move to failed: ${moveErr.message}`)
        }
      }
    }
  }

  console.log('\nDone!')
}

async function main() {
  console.log(`Scanning ${UPLOAD_DIR} for files to process...`)
  const files = await listFiles()
  await processFiles(files)
}

main().catch(console.error)
