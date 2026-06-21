import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// Misma tabla que `SII_DESTINO_LABELS` en scraper/lib/sii-catastro-cl.mjs —
// duplicada acá porque web/ y scraper/ son proyectos Node separados.
const SII_DESTINO_LABELS: Record<string, string> = {
  A: 'Agrícola',
  B: 'Agroindustrial',
  C: 'Comercio',
  D: 'Deporte y Recreación',
  E: 'Educación y Cultura',
  F: 'Forestal',
  G: 'Hotel, Motel',
  H: 'Habitacional',
  I: 'Industria',
  L: 'Bodega y Almacenaje',
  M: 'Minería',
  O: 'Oficina',
  P: 'Administración Pública y Defensa',
  Q: 'Culto',
  S: 'Salud',
  T: 'Transporte y Telecomunicaciones',
  V: 'Otros no considerados',
  W: 'Sitio Eriazo',
  Y: 'Gallineros, chancheras y otros',
  Z: 'Estacionamiento',
}

interface SiiRolMetadata {
  rol: string
  direccion: string | null
  avaluo_fiscal_total: number | null
  avaluo_exento: number | null
  contribucion_semestral: number | null
  codigo_ubicacion: 'R' | 'U' | 'E' | null
  superficie_terreno_m2: number | null
  sqm: number | null
  superficie_construida_total_m2: number | null
  numero_pisos: number | null
  anio_construccion: number | null
  property_type: string | null
  codigo_destino_principal: string | null
  rol_bien_comun_1: string | null
  rol_bien_comun_2: string | null
  rol_padre: string | null
  rol_cobro_anio: number | null
  rol_cobro_semestre: number | null
  rol_cobro_avaluo_total: number | null
  rol_cobro_avaluo_exento: number | null
  rol_cobro_cuota_trimestral: number | null
}

/**
 * GET /api/chile/sii-roles?comuna=15108&rol=100-1
 * GET /api/chile/sii-roles?comuna=15108&address=Estocolmo+540
 *
 * Datos reales del SII (Detalle Catastral + Rol de Cobro), subidos
 * manualmente desde sii.cl e ingeridos vía scraper/lib/sii-catastro-cl.mjs
 * (migración 0021_sii_catastro_cl.sql) — JAMÁS scraping en vivo contra sii.cl.
 *
 * - `rol` busca un Rol exacto y devuelve sus atributos + construcciones agregadas,
 *   incluyendo avalúo afecto/exento, contribución semestral, ubicación
 *   urbano/rural/E y el período (año/semestre) del Rol de Cobro vigente.
 * - `address` busca por similitud de trigramas (pg_trgm + unaccent) contra
 *   la dirección declarada en el catastro y devuelve hasta 5 candidatos.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const comuna = sp.get('comuna')?.trim()
  const rol = sp.get('rol')?.trim()
  const address = sp.get('address')?.trim()

  if (!comuna) {
    return NextResponse.json({ success: false, error: 'comuna requerido' }, { status: 400 })
  }
  if (!rol && !address) {
    return NextResponse.json({ success: false, error: 'rol o address requerido' }, { status: 400 })
  }

  try {
    if (rol) {
      const rolRes = await pool.query(
        `SELECT * FROM sii_roles_cl WHERE sii_comuna_code = $1 AND rol = $2 LIMIT 1`,
        [comuna, rol]
      )
      const rolRow = rolRes.rows[0]
      if (!rolRow) {
        return NextResponse.json({ success: true, data: null })
      }

      const constrRes = await pool.query(
        `
        SELECT
          COALESCE(SUM(superficie_m2), 0) AS superficie_total_m2,
          COALESCE(SUM(superficie_m2) FILTER (WHERE destino_code = 'H'), 0) AS superficie_habitacional_m2,
          MAX(numero_pisos) AS numero_pisos,
          MIN(anio_construccion) AS anio_construccion_original
        FROM sii_construcciones_cl WHERE rol_id = $1
        `,
        [rolRow.id]
      )
      const constr = constrRes.rows[0]
      const superficieHabitacional = Number(constr.superficie_habitacional_m2)
      const superficieTotal = Number(constr.superficie_total_m2)

      const data: SiiRolMetadata = {
        rol: rolRow.rol,
        direccion: rolRow.direccion ?? rolRow.rol_cobro_direccion ?? null,
        avaluo_fiscal_total: rolRow.avaluo_fiscal_total ?? rolRow.rol_cobro_avaluo_total ?? null,
        avaluo_exento: rolRow.avaluo_exento ?? rolRow.rol_cobro_avaluo_exento ?? null,
        contribucion_semestral: rolRow.contribucion_semestral ?? null,
        codigo_ubicacion: rolRow.codigo_ubicacion ?? rolRow.rol_cobro_codigo_ubicacion ?? null,
        superficie_terreno_m2: rolRow.superficie_terreno_m2,
        sqm: superficieHabitacional > 0 ? superficieHabitacional : superficieTotal || null,
        superficie_construida_total_m2: superficieTotal || null,
        numero_pisos: constr.numero_pisos,
        anio_construccion: constr.anio_construccion_original,
        property_type: rolRow.codigo_destino_principal ? SII_DESTINO_LABELS[rolRow.codigo_destino_principal] ?? null : null,
        codigo_destino_principal: rolRow.codigo_destino_principal,
        rol_bien_comun_1: rolRow.rol_bien_comun_1,
        rol_bien_comun_2: rolRow.rol_bien_comun_2,
        rol_padre: rolRow.rol_padre,
        rol_cobro_anio: rolRow.rol_cobro_anio ?? null,
        rol_cobro_semestre: rolRow.rol_cobro_semestre ?? null,
        rol_cobro_avaluo_total: rolRow.rol_cobro_avaluo_total ?? null,
        rol_cobro_avaluo_exento: rolRow.rol_cobro_avaluo_exento ?? null,
        rol_cobro_cuota_trimestral: rolRow.rol_cobro_cuota_trimestral ?? null,
      }

      return NextResponse.json({ success: true, data })
    }

    const matchRes = await pool.query(
      `
      SELECT rol, direccion,
             similarity(unaccent_immutable(upper(direccion)), unaccent_immutable(upper($2))) AS similarity
      FROM sii_roles_cl
      WHERE sii_comuna_code = $1
        AND direccion IS NOT NULL
        AND similarity(unaccent_immutable(upper(direccion)), unaccent_immutable(upper($2))) >= 0.4
      ORDER BY similarity DESC
      LIMIT 5
      `,
      [comuna, address]
    )

    return NextResponse.json({ success: true, data: matchRes.rows })
  } catch (error) {
    console.error('Error fetching SII roles:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch SII roles' }, { status: 500 })
  }
}
