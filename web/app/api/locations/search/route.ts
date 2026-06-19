import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

interface District {
  id: string
  name: string
  slug: string
}

interface Zone {
  id: string
  name: string
  slug: string
  district_id: string
}

interface Subzone {
  id: string
  name: string
  slug: string
  zone_id: string
}

interface SearchResult {
  districts: District[]
  zones: Zone[]
  subzones: Subzone[]
}

/**
 * GET /api/locations/search?q=<query>
 * Busca en distritos, zonas y subzonas por texto (ILIKE)
 * Útil para auto-completado y búsqueda por ubicación (migración 0019)
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const q = sp.get('q')?.trim()

    if (!q || q.length < 2) {
      return NextResponse.json(
        {
          success: false,
          error: 'Query must be at least 2 characters',
        },
        { status: 400 }
      )
    }

    const searchTerm = `%${q}%`

    // Buscar en distritos
    const districtsResult = await pool.query(
      'SELECT id, name, slug FROM districts WHERE name ILIKE $1 ORDER BY name ASC LIMIT 10',
      [searchTerm]
    )

    // Buscar en zonas
    const zonesResult = await pool.query(
      'SELECT id, name, slug, district_id FROM zones WHERE name ILIKE $1 ORDER BY name ASC LIMIT 10',
      [searchTerm]
    )

    // Buscar en subzonas
    const subzonesResult = await pool.query(
      'SELECT id, name, slug, zone_id FROM subzones WHERE name ILIKE $1 ORDER BY name ASC LIMIT 10',
      [searchTerm]
    )

    const result: SearchResult = {
      districts: districtsResult.rows,
      zones: zonesResult.rows,
      subzones: subzonesResult.rows,
    }

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error searching locations:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to search locations',
      },
      { status: 500 }
    )
  }
}
