import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

/**
 * GET /api/chile/sii-search?q=&comuna=&limit=20
 *
 * Búsqueda de roles SII por:
 *   - Dirección (texto libre, trigram similarity)
 *   - Rol exacto "manzana-predio" o "siiCode-manzana-predio"
 *
 * Devuelve hasta `limit` resultados ordenados por relevancia.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const q = sp.get('q')?.trim() ?? ''
  const comuna = sp.get('comuna')?.trim() ?? ''
  const limit = Math.min(parseInt(sp.get('limit') ?? '20', 10), 100)

  if (!q) {
    return NextResponse.json({ success: false, error: 'q requerido' }, { status: 400 })
  }

  try {
    // Detectar si es búsqueda por rol (ej: "795-198" o "15108 795-198")
    const rolMatch = q.match(/^(?:(\d{5})\s+)?(\d+)-(\d+)$/)

    let rows: any[]

    if (rolMatch) {
      const [, siiCode, manzana, predio] = rolMatch
      const params: any[] = [`${manzana}-${predio}`]
      let whereClause = 'rol = $1'
      if (siiCode) {
        params.push(siiCode)
        whereClause += ' AND sii_comuna_code = $2'
      } else if (comuna) {
        params.push(comuna)
        whereClause += ' AND sii_comuna_code = $2'
      }
      params.push(limit)
      const result = await pool.query(
        `SELECT
          r.id, r.sii_comuna_code, r.rol, r.direccion,
          r.avaluo_fiscal_total, r.avaluo_exento,
          r.contribucion_semestral, r.superficie_terreno_m2,
          r.codigo_destino_principal,
          r.lat, r.lng,
          c.name AS comuna_nombre
         FROM sii_roles_cl r
         LEFT JOIN chile_comunas c ON c.sii_comuna_code = r.sii_comuna_code
         WHERE ${whereClause}
         LIMIT $${params.length}`,
        params
      )
      rows = result.rows
    } else {
      // Búsqueda por dirección con trigram similarity
      const search = q.toUpperCase()
      const params: any[] = [search, `%${search}%`, limit]
      let communaFilter = ''
      if (comuna) {
        params.push(comuna)
        communaFilter = `AND r.sii_comuna_code = $${params.length}`
      }

      const result = await pool.query(
        `SELECT
          r.id, r.sii_comuna_code, r.rol, r.direccion,
          r.avaluo_fiscal_total, r.avaluo_exento,
          r.contribucion_semestral, r.superficie_terreno_m2,
          r.codigo_destino_principal,
          r.lat, r.lng,
          c.name AS comuna_nombre,
          similarity(unaccent_immutable(upper(coalesce(r.direccion,''))), unaccent_immutable($1)) AS sim
         FROM sii_roles_cl r
         LEFT JOIN chile_comunas c ON c.sii_comuna_code = r.sii_comuna_code
         WHERE unaccent_immutable(upper(coalesce(r.direccion,''))) LIKE unaccent_immutable($2)
         ${communaFilter}
         ORDER BY sim DESC, r.avaluo_fiscal_total DESC NULLS LAST
         LIMIT $3`,
        params
      )
      rows = result.rows
    }

    return NextResponse.json({
      success: true,
      results: rows.map((r) => ({
        id: r.id,
        sii_comuna_code: r.sii_comuna_code,
        comuna_nombre: r.comuna_nombre ?? r.sii_comuna_code,
        rol: r.rol,
        direccion: r.direccion,
        avaluo_fiscal_total: r.avaluo_fiscal_total ? Number(r.avaluo_fiscal_total) : null,
        avaluo_exento: r.avaluo_exento ? Number(r.avaluo_exento) : null,
        contribucion_semestral: r.contribucion_semestral ? Number(r.contribucion_semestral) : null,
        superficie_terreno_m2: r.superficie_terreno_m2 ? Number(r.superficie_terreno_m2) : null,
        codigo_destino_principal: r.codigo_destino_principal,
        lat: r.lat ? Number(r.lat) : null,
        lng: r.lng ? Number(r.lng) : null,
      })),
    })
  } catch (error) {
    console.error('sii-search error:', error)
    return NextResponse.json({ success: false, error: 'Error en búsqueda' }, { status: 500 })
  }
}
