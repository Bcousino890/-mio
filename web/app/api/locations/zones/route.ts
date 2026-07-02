import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

interface Zone {
  id: string
  name: string
  slug: string
}

/**
 * GET /api/locations/zones?district_id=<uuid>
 * Retorna lista de zonas para un distrito específico (migración 0019)
 * Si no se proporciona district_id, retorna todas las zonas
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const districtId = sp.get('district_id')?.trim()

    let query = 'SELECT id, name, slug FROM zones'
    const params: string[] = []

    if (districtId) {
      query += ' WHERE district_id = $1'
      params.push(districtId)
    }

    query += ' ORDER BY name ASC'

    const result = await pool.query(query, params)
    const zones: Zone[] = result.rows

    return NextResponse.json(
      {
        success: true,
        data: zones,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error fetching zones:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch zones',
      },
      { status: 500 }
    )
  }
}
