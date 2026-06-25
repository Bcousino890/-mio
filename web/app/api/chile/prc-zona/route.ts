/**
 * GET /api/chile/prc-zona?rol=795-198&comuna=13132
 * GET /api/chile/prc-zona?lat=-33.37&lng=-70.54&comuna=13132
 *
 * Devuelve la zona de regulación y normativas para un rol o coordenadas.
 * Información de PRC (Plan Regulador Comunal) + altura máxima, densidad, usos permitidos.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const rol = sp.get('rol')?.trim()
  const comuna = sp.get('comuna')?.trim()
  const lat = sp.get('lat')
  const lng = sp.get('lng')

  // ─── Validación ─────────────────────────────────────────────────────────────
  if (!comuna) {
    return NextResponse.json(
      { success: false, error: 'Parámetro "comuna" requerido' },
      { status: 400 }
    )
  }

  if (!rol && (!lat || !lng)) {
    return NextResponse.json(
      { success: false, error: 'Proporcionar "rol" o coordenadas (lat, lng)' },
      { status: 400 }
    )
  }

  try {
    if (rol) {
      // ─── Query por rol específico ───────────────────────────────────────────
      const result = await pool.query(
        `
        SELECT
          sr.id,
          sr.rol,
          sr.direccion,
          sr.sii_comuna_code,
          sr.lat,
          sr.lng,
          sr.avaluo_fiscal_total,
          sr.superficie_terreno_m2,
          sr.superficie_construida_total_m2,
          -- Zonificación PRC
          pz.id AS prc_zona_id,
          pz.zona_nombre,
          pz.zona_codigo,
          pz.descripcion AS zona_descripcion,
          pz.altura_maxima_m,
          pz.numero_pisos_maximo,
          pz.densidad_viviendas_ha,
          pz.fos_maximo,
          pz.far_maximo,
          pz.usos_permitidos,
          pz.usos_prohibidos,
          pz.confidence AS prc_confidence
        FROM sii_roles_cl sr
        LEFT JOIN prc_zonas pz ON sr.prc_zona_id = pz.id
        WHERE sr.sii_comuna_code = $1 AND sr.rol = $2
        LIMIT 1;
        `,
        [comuna, rol]
      )

      const rolData = result.rows[0]
      if (!rolData) {
        return NextResponse.json(
          { success: true, data: null, message: 'Rol no encontrado' }
        )
      }

      return NextResponse.json({
        success: true,
        data: {
          rol: {
            id: rolData.id,
            rol: rolData.rol,
            direccion: rolData.direccion,
            avaluo_fiscal_total: rolData.avaluo_fiscal_total,
            superficie_terreno_m2: rolData.superficie_terreno_m2,
            superficie_construida_total_m2: rolData.superficie_construida_total_m2,
            lat: rolData.lat,
            lng: rolData.lng
          },
          prc_zona: rolData.prc_zona_id ? {
            id: rolData.prc_zona_id,
            nombre: rolData.zona_nombre,
            codigo: rolData.zona_codigo,
            descripcion: rolData.zona_descripcion,
            normativas: {
              altura_maxima_m: rolData.altura_maxima_m,
              numero_pisos_maximo: rolData.numero_pisos_maximo,
              densidad_viviendas_ha: rolData.densidad_viviendas_ha,
              fos_maximo: rolData.fos_maximo,
              far_maximo: rolData.far_maximo
            },
            usos: {
              permitidos: rolData.usos_permitidos,
              prohibidos: rolData.usos_prohibidos
            },
            confianza: rolData.prc_confidence
          } : null
        }
      })
    } else {
      // ─── Query por coordenadas ──────────────────────────────────────────────
      const latNum = parseFloat(lat as string)
      const lngNum = parseFloat(lng as string)

      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
        return NextResponse.json(
          { success: false, error: 'Coordenadas inválidas' },
          { status: 400 }
        )
      }

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
          ST_AsGeoJSON(pz.geom)::json AS geom_geojson,
          ST_Distance(
            ST_Point($2, $1),
            ST_Centroid(pz.geom)
          ) AS distance_m
        FROM prc_zonas pz
        WHERE pz.sii_comuna_code = $3
          AND pz.geom IS NOT NULL
          AND ST_DWithin(
            pz.geom,
            ST_SetSRID(ST_Point($2, $1), 4326),
            0.01  -- ~1 km buffer
          )
        ORDER BY distance_m ASC
        LIMIT 1;
        `,
        [latNum, lngNum, comuna]
      )

      const zonaData = result.rows[0]
      if (!zonaData) {
        return NextResponse.json({
          success: true,
          data: null,
          message: 'No hay zona PRC para estas coordenadas'
        })
      }

      return NextResponse.json({
        success: true,
        data: {
          prc_zona: {
            id: zonaData.id,
            nombre: zonaData.zona_nombre,
            codigo: zonaData.zona_codigo,
            descripcion: zonaData.descripcion,
            normativas: {
              altura_maxima_m: zonaData.altura_maxima_m,
              numero_pisos_maximo: zonaData.numero_pisos_maximo,
              densidad_viviendas_ha: zonaData.densidad_viviendas_ha,
              fos_maximo: zonaData.fos_maximo,
              far_maximo: zonaData.far_maximo
            },
            usos: {
              permitidos: zonaData.usos_permitidos,
              prohibidos: zonaData.usos_prohibidos
            },
            confianza: zonaData.confidence,
            distancia_m: Math.round(zonaData.distance_m * 1000)  // Convertir a metros
          },
          geometry: zonaData.geom_geojson
        }
      })
    }
  } catch (err) {
    console.error('Error en /api/chile/prc-zona:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Error desconocido' },
      { status: 500 }
    )
  }
}
