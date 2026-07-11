import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const runtime = 'nodejs'

interface Shape {
  type: 'polygon' | 'circle' | 'rectangle'
  coordinates?: [number, number][] // [lat, lng]
  center?: [number, number] // [lat, lng]
  radius?: number // metros
}

// Construye la condición geográfica sobre una columna geom(Point,4326) a
// partir del shape dibujado, con los parámetros ya numerados desde `start`.
// Mismo modelo de shape que /api/chile/sii-roles-in-zone.
function geoCond(shape: Shape, geomExpr: string, start: number): { sql: string; params: (string | number)[] } {
  if (shape.type === 'circle') {
    if (!shape.center || !shape.radius) throw new Error('circle requiere center y radius')
    return {
      sql: `ST_DWithin(${geomExpr}::geography, ST_SetSRID(ST_MakePoint($${start}, $${start + 1}), 4326)::geography, $${start + 2})`,
      params: [shape.center[1], shape.center[0], shape.radius],
    }
  }
  if (!shape.coordinates || shape.coordinates.length < 4) throw new Error('polígono requiere ≥4 coordenadas')
  const wkt = `POLYGON((${shape.coordinates.map(([lat, lng]) => `${lng} ${lat}`).join(', ')}))`
  return { sql: `ST_Contains(ST_GeomFromText($${start}, 4326), ${geomExpr})`, params: [wkt] }
}

// Anuncios de venta activos dentro del shape (la señal de "novedades").
async function countListings(siiComunaCode: string, shape: Shape): Promise<number> {
  const g = geoCond(shape, 'l.geom', 2)
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n
     FROM listings_cl l
     JOIN chile_comunas c ON c.id = l.comuna_id
     WHERE c.sii_comuna_code = $1 AND l.is_active AND l.operation = 'sale'
       AND l.geom IS NOT NULL AND ${g.sql}`,
    [siiComunaCode, ...g.params]
  )
  return Number(rows[0]?.n ?? 0)
}

// Roles SII dentro del shape (estático — solo se guarda como contexto).
async function countRoles(siiComunaCode: string, shape: Shape): Promise<number> {
  const g = geoCond(shape, 'cp.geom', 2)
  const { rows } = await pool.query(
    `SELECT count(DISTINCT sr.rol)::int AS n
     FROM cadastre_parcels_cl cp
     JOIN chile_comunas cc ON cp.comuna_id = cc.id
     JOIN sii_roles_cl sr ON cp.rol = sr.rol AND cc.sii_comuna_code = sr.sii_comuna_code
     WHERE cc.sii_comuna_code = $1 AND ${g.sql}`,
    [siiComunaCode, ...g.params]
  )
  return Number(rows[0]?.n ?? 0)
}

// GET — lista de watchlists con conteo actual y novedades (delta vs baseline).
export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, sii_comuna_code, shape, baseline_listings, baseline_roles, last_checked_at, created_at
       FROM watchlists_cl ORDER BY created_at DESC`
    )
    const items = await Promise.all(rows.map(async (w) => {
      let current = w.baseline_listings
      try { current = await countListings(w.sii_comuna_code, w.shape as Shape) } catch { /* shape inválido: deja baseline */ }
      return {
        id: w.id,
        name: w.name,
        sii_comuna_code: w.sii_comuna_code,
        shape: w.shape,
        baseline_listings: w.baseline_listings,
        baseline_roles: w.baseline_roles,
        current_listings: current,
        novedades: Math.max(0, current - w.baseline_listings),
        last_checked_at: w.last_checked_at,
        created_at: w.created_at,
      }
    }))
    return NextResponse.json({ success: true, data: items })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}

// POST — crear watchlist a partir de una zona dibujada.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const name = String(body.name ?? '').trim()
    const siiComunaCode = String(body.sii_comuna_code ?? '').trim()
    const shape = body.shape as Shape | undefined
    if (!name || !siiComunaCode || !shape) {
      return NextResponse.json({ success: false, error: 'name, sii_comuna_code y shape requeridos' }, { status: 400 })
    }
    const [listings, roles] = await Promise.all([
      countListings(siiComunaCode, shape).catch(() => 0),
      countRoles(siiComunaCode, shape).catch(() => 0),
    ])
    const { rows } = await pool.query(
      `INSERT INTO watchlists_cl (name, sii_comuna_code, shape, baseline_listings, baseline_roles)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, siiComunaCode, JSON.stringify(shape), listings, roles]
    )
    return NextResponse.json({ success: true, id: rows[0].id, baseline_listings: listings, baseline_roles: roles })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}

// PATCH — marcar como vista: baseline pasa a ser el conteo actual.
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const id = String(body.id ?? '').trim()
    if (!id) return NextResponse.json({ success: false, error: 'id requerido' }, { status: 400 })
    const { rows } = await pool.query(`SELECT sii_comuna_code, shape FROM watchlists_cl WHERE id = $1`, [id])
    if (!rows[0]) return NextResponse.json({ success: false, error: 'No encontrada' }, { status: 404 })
    const current = await countListings(rows[0].sii_comuna_code, rows[0].shape as Shape).catch(() => 0)
    await pool.query(`UPDATE watchlists_cl SET baseline_listings = $2, last_checked_at = now() WHERE id = $1`, [id, current])
    return NextResponse.json({ success: true, baseline_listings: current })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}

// DELETE — ?id=uuid
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id')?.trim()
    if (!id) return NextResponse.json({ success: false, error: 'id requerido' }, { status: 400 })
    await pool.query(`DELETE FROM watchlists_cl WHERE id = $1`, [id])
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
