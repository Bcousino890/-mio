import { NextResponse } from 'next/server'
import { Pool } from 'pg'

export const runtime = 'nodejs'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export async function GET() {
  try {
    const result = await pool.query(
      'SELECT id, name, region FROM chile_comunas ORDER BY region, name'
    )
    return NextResponse.json({ success: true, comunas: result.rows })
  } catch (error) {
    console.error('Error fetching comunas:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error al obtener comunas' },
      { status: 500 }
    )
  }
}
