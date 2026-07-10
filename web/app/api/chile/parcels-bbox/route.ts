import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

/**
 * GET /api/chile/parcels-bbox?bbox=lng1,lat1,lng2,lat2&comuna=15160&limit=2000&enrich=1
 *
 * Devuelve GeoJSON FeatureCollection de predios en el viewport.
 * Requiere zoom alto (bbox pequeño) para no sobrecargar.
 * Máx 2000 predios por request.
 *
 * Con enrich=1 añade a cada feature los datos SII del rol (avalúo, superficie,
 * avalúo/m², destino) y si tiene deuda TGR — alimenta las capas analíticas
 * (coropletas) del visor. LATERAL con LIMIT 1 porque un mismo rol puede tener
 * más de una fila en sii_roles_cl (reprocesos); se toma la de mayor avalúo.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const bboxStr = sp.get('bbox')
  const comuna = sp.get('comuna')
  const enrich = sp.get('enrich') === '1'
  const limit = Math.min(parseInt(sp.get('limit') ?? '2000'), 5000)

  if (!bboxStr) {
    return NextResponse.json({ success: false, error: 'bbox requerido' }, { status: 400 })
  }

  const parts = bboxStr.split(',').map(Number)
  if (parts.length !== 4 || parts.some(isNaN)) {
    return NextResponse.json({ success: false, error: 'bbox inválido: lng1,lat1,lng2,lat2' }, { status: 400 })
  }

  const [lng1, lat1, lng2, lat2] = parts

  // Límite de área para evitar queries masivos (≈ 10km × 10km máx)
  if (Math.abs(lng2 - lng1) > 0.15 || Math.abs(lat2 - lat1) > 0.15) {
    return NextResponse.json({ success: true, features: [], message: 'Zoom más para ver predios' })
  }

  try {
    const whereClause = comuna
      ? `WHERE ST_Intersects(p.geom, ST_MakeEnvelope($1,$2,$3,$4,4326)) AND cc.sii_comuna_code = $5`
      : `WHERE ST_Intersects(p.geom, ST_MakeEnvelope($1,$2,$3,$4,4326))`

    const params = comuna
      ? [lng1, lat1, lng2, lat2, comuna]
      : [lng1, lat1, lng2, lat2]

    const enrichSelect = enrich
      ? `,
         sr.avaluo_fiscal_total,
         sr.superficie_terreno_m2,
         sr.codigo_destino_principal,
         t.tiene_deuda`
      : ''

    const enrichJoins = enrich
      ? `LEFT JOIN LATERAL (
           SELECT avaluo_fiscal_total, superficie_terreno_m2, codigo_destino_principal
           FROM sii_roles_cl sr
           WHERE sr.sii_comuna_code = cc.sii_comuna_code AND sr.rol = p.rol
           ORDER BY sr.avaluo_fiscal_total DESC NULLS LAST
           LIMIT 1
         ) sr ON true
         LEFT JOIN LATERAL (
           SELECT tiene_deuda
           FROM tgr_certificados t
           WHERE t.rol = cc.sii_comuna_code || '-' || p.rol
           LIMIT 1
         ) t ON true`
      : ''

    const res = await pool.query(
      `SELECT
         p.id,
         p.rol,
         p.comuna_id,
         cc.name AS comuna_name,
         cc.sii_comuna_code${enrichSelect},
         ST_AsGeoJSON(ST_SimplifyPreserveTopology(p.geom, 0.000005))::json AS geojson
       FROM cadastre_parcels_cl p
       JOIN chile_comunas cc ON cc.id = p.comuna_id
       ${enrichJoins}
       ${whereClause}
       LIMIT ${limit}`,
      params
    )

    const features = res.rows.map((row) => {
      const avaluo = row.avaluo_fiscal_total != null ? Number(row.avaluo_fiscal_total) : null
      const superficie = row.superficie_terreno_m2 != null ? Number(row.superficie_terreno_m2) : null
      return {
        type: 'Feature' as const,
        properties: {
          id: row.id,
          rol: row.rol,
          comuna_id: row.comuna_id,
          comuna_name: row.comuna_name,
          sii_comuna_code: row.sii_comuna_code,
          ...(enrich ? {
            avaluo_fiscal_total: avaluo,
            superficie_terreno_m2: superficie,
            avaluo_por_m2: avaluo != null && superficie ? Math.round(avaluo / superficie) : null,
            codigo_destino_principal: row.codigo_destino_principal ?? null,
            tiene_deuda: row.tiene_deuda ?? null,
          } : {}),
        },
        geometry: row.geojson,
      }
    })

    return NextResponse.json({
      success: true,
      count: features.length,
      features,
    }, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    })
  } catch (error) {
    console.error('parcels-bbox error:', error)
    return NextResponse.json({ success: false, error: 'Error al obtener predios' }, { status: 500 })
  }
}
