import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { normalizeClRol } from '@/lib/rol-format'
import { unitBaseAddressExpr } from '@/lib/sii-edificio-sql'

const UNIT_COLUMNS = `rol, direccion, avaluo_fiscal_total, superficie_terreno_m2,
              codigo_destino_principal, rol_padre, rol_bien_comun_1, rol_bien_comun_2,
              manzana, predio`

/**
 * GET /api/chile/sii-building-units?sii_comuna_code=15108&rol_padre=795-1
 * GET /api/chile/sii-building-units?sii_comuna_code=15103&rol=1935-39
 *
 * Unidades (departamentos/bodegas/estacionamientos) de un edificio o
 * condominio. Dos modos:
 *  - rol_padre: vínculo oficial de los archivos SII subidos a mano.
 *  - rol: fallback nacional — el dataset de catastral.cl trae rol_padre NULL
 *    en todo Chile, así que se agrupa por dirección base (ver
 *    web/lib/sii-edificio-sql.ts): hermanos = mismos comuna + dirección base.
 * Si se pasan ambos, se intenta rol_padre primero y se cae a dirección si
 * no hay filas.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const siiComunaCode = sp.get('sii_comuna_code')?.trim()
  const rolPadre = sp.get('rol_padre')?.trim()
  const rolParam = sp.get('rol')?.trim()

  if (!siiComunaCode || (!rolPadre && !rolParam)) {
    return NextResponse.json({ success: false, error: 'sii_comuna_code and rol_padre or rol required' }, { status: 400 })
  }

  try {
    if (rolPadre) {
      const res = await pool.query(
        `SELECT ${UNIT_COLUMNS}
         FROM sii_roles_cl
         WHERE sii_comuna_code = $1 AND rol_padre = $2
         ORDER BY manzana ASC, predio ASC
         LIMIT 500`,
        [siiComunaCode, rolPadre]
      )
      if (res.rows.length > 0 || !rolParam) {
        return NextResponse.json({
          success: true,
          mode: 'rol_padre',
          rol_padre: rolPadre,
          total: res.rows.length,
          units: res.rows,
        })
      }
    }

    // Fallback por dirección base. El prefiltro LIKE sobre la expresión del
    // índice trigram (0021) acota el barrido antes del regexp exacto.
    const rol = normalizeClRol(rolParam!)
    const baseExpr = unitBaseAddressExpr('direccion')
    const res = await pool.query(
      `WITH me AS (
         SELECT ${baseExpr} AS base
         FROM sii_roles_cl
         WHERE sii_comuna_code = $1 AND rol = $2 AND direccion IS NOT NULL
         LIMIT 1
       )
       SELECT r.rol, r.direccion, r.avaluo_fiscal_total, r.superficie_terreno_m2,
              r.codigo_destino_principal, r.rol_padre, r.rol_bien_comun_1, r.rol_bien_comun_2,
              r.manzana, r.predio, me.base AS direccion_base
       FROM sii_roles_cl r, me
       WHERE r.sii_comuna_code = $1
         AND unaccent_immutable(upper(coalesce(r.direccion, ''))) LIKE unaccent_immutable(upper(me.base)) || '%'
         AND ${unitBaseAddressExpr('r.direccion')} = me.base
       ORDER BY r.manzana ASC, r.predio ASC
       LIMIT 500`,
      [siiComunaCode, rol]
    )

    return NextResponse.json({
      success: true,
      mode: 'direccion',
      direccion_base: res.rows[0]?.direccion_base ?? null,
      total: res.rows.length,
      units: res.rows,
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
