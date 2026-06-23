#!/usr/bin/env node
/**
 * Trigger manual processing of pending uploads.
 * Usage: node process-uploads.mjs
 *
 * Delegates to the Next.js worker endpoint (same code path the cron job
 * hits) instead of duplicating the SII/Parquet ingestion logic here in JS.
 */

const APP_URL = process.env.APP_URL || 'http://localhost:3000'
const PROCESSING_SECRET = process.env.PROCESSING_SECRET

async function main() {
  const url = `${APP_URL}/api/admin/process-uploads-worker`
  console.log(`Triggering ${url}...`)

  const res = await fetch(url, {
    method: 'POST',
    headers: PROCESSING_SECRET ? { Authorization: `Bearer ${PROCESSING_SECRET}` } : {},
  })

  const data = await res.json()
  if (!res.ok || !data.success) {
    console.error('✗ Error:', data.error || `HTTP ${res.status}`)
    process.exitCode = 1
    return
  }

  console.log(`✓ ${data.message}`)
}

main().catch((err) => {
  console.error('✗ Error:', err.message)
  process.exitCode = 1
})
