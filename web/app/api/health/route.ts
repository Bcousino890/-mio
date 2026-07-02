import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health — healthcheck para docker-compose (infra/docker-compose.yml)
 * y monitoreo. Antes el healthcheck del contenedor apuntaba aquí sin que la
 * ruta existiera.
 */
export async function GET() {
  try {
    await pool.query('SELECT 1')
    return NextResponse.json({ ok: true, db: 'up', ts: new Date().toISOString() })
  } catch (error) {
    return NextResponse.json(
      { ok: false, db: 'down', error: error instanceof Error ? error.message : 'unknown', ts: new Date().toISOString() },
      { status: 503 },
    )
  }
}
