import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { normalizeClRol } from '@/lib/rol-format'

/**
 * GET /api/chile/sii-search?q=&comuna=&limit=20
 *
 * Búsqueda de roles SII por:
 *   - Dirección (texto libre, trigram similarity)
 *   - Rol exacto "manzana-predio" o "siiCode-manzana-predio"
 *
 * Busca primero en `sii_roles_cl` (archivos planos oficiales, descarga
 * manual — ver 0021_sii_catastro_cl.sql). Si no hay resultados ahí, cae a
 * `sii_mapasui_predios_cl` (scraping de mapasui — ver
 * 0052_sii_mapasui_predios_cl.sql), marcando cada resultado con `source` para
 * que el consumidor sepa distinguir la procedencia (la de mapasui es legalmente
 * más frágil y nunca debe tratarse como equivalente a la oficial).
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
      const params: any[] = [normalizeClRol(`${manzana}-${predio}`)]
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

    let source: 'oficial' | 'mapasui_scrape' = 'oficial'
    let mapped = rows.map((r) => ({
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
      source,
    }))

    if (mapped.length === 0) {
      mapped = await searchMapasuiFallback({ q, comuna, limit })
      source = 'mapasui_scrape'
    }

    return NextResponse.json({ success: true, results: mapped })
  } catch (error) {
    console.error('sii-search error:', error)
    return NextResponse.json({ success: false, error: 'Error en búsqueda' }, { status: 500 })
  }
}

/**
 * Fallback contra `sii_mapasui_predios_cl` cuando `sii_roles_cl` no tiene el
 * Rol/dirección buscado. Procedencia de scraping (ver 0052) — cada resultado
 * se marca `source: 'mapasui_scrape'` para no confundirlo con dato oficial.
 */
async function searchMapasuiFallback({ q, comuna, limit }: { q: string; comuna: string; limit: number }) {
  const rolMatch = q.match(/^(?:(\d{5})\s+)?(\d+)-(\d+)$/)

  let rows: any[]
  if (rolMatch) {
    const [, siiCode, manzana, predio] = rolMatch
    const params: any[] = [`${manzana}-${predio}`]
    let whereClause = 'm.rol = $1'
    const commCode = siiCode || comuna
    if (commCode) {
      params.push(commCode)
      whereClause += ` AND m.sii_comuna_code = $${params.length}`
    }
    params.push(limit)
    const result = await pool.query(
      `SELECT m.id, m.sii_comuna_code, m.rol, m.direccion,
              m.avaluo_total, m.avaluo_exento, m.lat, m.lng,
              c.name AS comuna_nombre
       FROM sii_mapasui_predios_cl m
       LEFT JOIN chile_comunas c ON c.sii_comuna_code = m.sii_comuna_code
       WHERE ${whereClause}
       LIMIT $${params.length}`,
      params
    )
    rows = result.rows
  } else {
    const search = q.toUpperCase()
    const params: any[] = [search, `%${search}%`, limit]
    let communaFilter = ''
    if (comuna) {
      params.push(comuna)
      communaFilter = `AND m.sii_comuna_code = $${params.length}`
    }
    const result = await pool.query(
      `SELECT m.id, m.sii_comuna_code, m.rol, m.direccion,
              m.avaluo_total, m.avaluo_exento, m.lat, m.lng,
              c.name AS comuna_nombre,
              similarity(unaccent_immutable(upper(coalesce(m.direccion,''))), unaccent_immutable($1)) AS sim
       FROM sii_mapasui_predios_cl m
       LEFT JOIN chile_comunas c ON c.sii_comuna_code = m.sii_comuna_code
       WHERE unaccent_immutable(upper(coalesce(m.direccion,''))) LIKE unaccent_immutable($2)
       ${communaFilter}
       ORDER BY sim DESC, m.avaluo_total DESC NULLS LAST
       LIMIT $3`,
      params
    )
    rows = result.rows
  }

  return rows.map((r) => ({
    id: r.id,
    sii_comuna_code: r.sii_comuna_code,
    comuna_nombre: r.comuna_nombre ?? r.sii_comuna_code,
    rol: r.rol,
    direccion: r.direccion,
    avaluo_fiscal_total: r.avaluo_total ? Number(r.avaluo_total) : null,
    avaluo_exento: r.avaluo_exento ? Number(r.avaluo_exento) : null,
    contribucion_semestral: null,
    superficie_terreno_m2: null,
    codigo_destino_principal: null,
    lat: r.lat ? Number(r.lat) : null,
    lng: r.lng ? Number(r.lng) : null,
    source: 'mapasui_scrape' as const,
  }))
}
