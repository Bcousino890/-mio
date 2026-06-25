/**
 * GET /api/chile/prc-zonas-list?comuna=13132
 *
 * Devuelve todas las zonas de regulación de una comuna con sus normativas.
 * Útil para dropdowns, filtros, análisis comparativo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const comuna = sp.get('comuna')?.trim()

  if (!comuna) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "comuna" requerido' },
      { status: 400 }
    )
  }

  try {
    const result = await pool.query(
      `
      SELECT
        pz.id,
        pz.zona_nombre,
        pz.zona_codigo,
        pz.descripcion,
        pz.altura_maxima_m,
        pz.numero_pisos_maximo,
        pz.densidad_viviendas_ha,
        pz.fos_maximo,
        pz.far_maximo,
        pz.usos_permitidos,
        pz.usos_prohibidos,
        pz.confidence,
        -- Estadísticas: cuántos roles caen en esta zona
        (SELECT COUNT(*) FROM sii_roles_cl sr
         WHERE sr.prc_zona_id = pz.id) AS numero_roles,
        -- Avalúo promedio
        (SELECT AVG(avaluo_fiscal_total)::bigint FROM sii_roles_cl sr
         WHERE sr.prc_zona_id = pz.id) AS avaluo_promedio,
        -- Valor m² promedio
        (SELECT AVG(CASE
          WHEN superficie_construida_total_m2 > 0
          THEN avaluo_fiscal_total / superficie_construida_total_m2
          ELSE NULL
        END)::int FROM sii_roles_cl sr
         WHERE sr.prc_zona_id = pz.id) AS valor_m2_promedio
      FROM prc_zonas pz
      WHERE pz.sii_comuna_code = $1
      ORDER BY pz.zona_codigo ASC;
      `,
      [comuna]
    )

    const zonas = result.rows.map(row => ({
      id: row.id,
      nombre: row.zona_nombre,
      codigo: row.zona_codigo,
      descripcion: row.descripcion,
      normativas: {
        altura_maxima_m: row.altura_maxima_m,
        numero_pisos_maximo: row.numero_pisos_maximo,
        densidad_viviendas_ha: row.densidad_viviendas_ha,
        fos_maximo: row.fos_maximo,
        far_maximo: row.far_maximo
      },
      usos: {
        permitidos: row.usos_permitidos,
        prohibidos: row.usos_prohibidos
      },
      confianza: row.confidence,
      estadisticas: {
        numero_roles: row.numero_roles,
        avaluo_promedio_clp: row.avaluo_promedio,
        valor_m2_promedio: row.valor_m2_promedio
      }
    }))

    return NextResponse.json({
      success: true,
      count: zonas.length,
      data: zonas
    })
  } catch (err) {
    console.error('Error en /api/chile/prc-zonas-list:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Error desconocido' },
      { status: 500 }
    )
  }
}
