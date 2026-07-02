import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

interface Subzone {
  id: string
  name: string
  slug: string
}

/**
 * GET /api/locations/subzones?zone_id=<uuid>
 * Retorna lista de subzonas para una zona específica (migración 0019)
 * Si no se proporciona zone_id, retorna todas las subzonas
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const zoneId = sp.get('zone_id')?.trim()

    let query = 'SELECT id, name, slug FROM subzones'
    const params: string[] = []

    if (zoneId) {
      query += ' WHERE zone_id = $1'
      params.push(zoneId)
    }

    query += ' ORDER BY name ASC'

    const result = await pool.query(query, params)
    const subzones: Subzone[] = result.rows

    return NextResponse.json(
      {
        success: true,
        data: subzones,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error fetching subzones:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch subzones',
      },
      { status: 500 }
    )
  }
}
