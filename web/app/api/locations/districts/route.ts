import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

interface District {
  id: string
  name: string
  slug: string
  code: string
}

/**
 * GET /api/locations/districts
 * Retorna lista de todos los distritos de Madrid (migración 0019)
 */
export async function GET(request: NextRequest) {
  try {
    const result = await pool.query(
      `SELECT id, name, slug, code FROM districts ORDER BY code ASC`
    )

    const districts: District[] = result.rows

    return NextResponse.json(
      {
        success: true,
        data: districts,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error fetching districts:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch districts',
      },
      { status: 500 }
    )
  }
}
