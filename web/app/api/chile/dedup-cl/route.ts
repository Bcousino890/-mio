import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// /api/chile/dedup-cl — lanzar la deduplicación a mano (plan Anuncios CL · H3).
//
// La regla es la única vigente (decisión del usuario): dos anuncios son la
// MISMA propiedad solo si coinciden la corredora Y su código interno (ej.
// KD92695). Si no coinciden ambos, no se agrupan — ni siquiera entre anuncios
// de la misma corredora. Los que sí coinciden quedan bajo una ficha común,
// incluyendo el caso de una propiedad publicada a la vez en venta y arriendo.
//
// El worker ya corre esto cada 15 min; este endpoint solo lo adelanta encolando
// el job `dedup-cluster-cl`, para no esperar al siguiente ciclo tras un barrido.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

const QUEUE = 'dedup-cluster-cl'

export async function POST() {
  try {
    // No apilar corridas: si ya hay una en cola o ejecutándose, pulsar otra vez
    // no encola una segunda (el trabajo es el mismo y se pisarían los locks).
    const pendientes = await pool.query(
      `SELECT count(*)::int AS n FROM pgboss.job
       WHERE name = $1 AND state IN ('created', 'active')`,
      [QUEUE]
    )
    if ((pendientes.rows[0]?.n ?? 0) > 0) {
      return NextResponse.json({
        success: true,
        queued: false,
        message: 'Ya hay una deduplicación en marcha — al terminar verás las fichas agrupadas.',
      })
    }

    await pool.query(
      `INSERT INTO pgboss.job (name, data) VALUES ($1, $2::jsonb)`,
      [QUEUE, JSON.stringify({ origen: 'manual' })]
    )
    return NextResponse.json({
      success: true,
      queued: true,
      message: 'Deduplicación lanzada (corredora + código interno). Tarda un momento; refresca para ver las fichas agrupadas.',
    })
  } catch (error) {
    console.error('Error lanzando dedup-cl:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// Estado: si hay una corrida en cola/en curso y cuándo fue la última.
export async function GET() {
  try {
    const [pend, last] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND state IN ('created','active')`,
        [QUEUE]
      ),
      pool.query(
        `SELECT max(completed_on) AS t FROM pgboss.job WHERE name = $1 AND state = 'completed'`,
        [QUEUE]
      ),
    ])
    return NextResponse.json({
      success: true,
      running: (pend.rows[0]?.n ?? 0) > 0,
      last_run_at: last.rows[0]?.t ?? null,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
