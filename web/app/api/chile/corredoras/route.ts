import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// /api/chile/corredoras — entidad corredora consolidada (plan Anuncios CL · H4).
// Lista las corredoras (consolidadas por advertiser_id de Mercado Libre) con sus
// métricas derivadas (stock activo, rotación, exclusividad, comunas de
// operación). La ficha individual con su inventario vive en
// /api/chile/corredoras/[id].
// ─────────────────────────────────────────────────────────────────────────────

const SORT_CLAUSES: Record<string, string> = {
  stock: 'active_listings_count DESC',
  total: 'total_listings_seen DESC',
  rotacion: 'avg_days_on_market ASC NULLS LAST',
  exclusividad: 'exclusivity_ratio DESC NULLS LAST',
  nombre: 'name_normalized ASC NULLS LAST',
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams

  const q = sp.get('q')?.trim() // búsqueda por nombre
  const crmPlatform = sp.get('crm_platform')?.trim() // convecta | ofinet | other | unknown
  const comuna = sp.get('comuna')?.trim() // opera en esta comuna
  const onlyWithWeb = sp.get('only_with_web') === 'true'
  const onlyActive = sp.get('only_active') !== 'false' // por defecto, solo con stock activo

  const sortParam = sp.get('sort')
  const sort = sortParam && SORT_CLAUSES[sortParam] ? sortParam : 'stock'

  const page = Math.max(1, Number(sp.get('page')) || 1)
  // Corredoras está acotado por advertisers ÚNICOS (no por anuncios): a
  // diferencia de listings_cl/property_cl, el cap alto es seguro — el
  // directorio (/chile/corredoras) pide todas de una vez, sin paginar.
  const pageSize = Math.min(Math.max(1, Number(sp.get('page_size')) || 30), 5000)
  const offset = (page - 1) * pageSize

  try {
    const params: (string | number)[] = []
    const addParam = (value: string | number) => {
      params.push(value)
      return `$${params.length}`
    }

    const conditions: string[] = []
    if (q) conditions.push(`name_normalized ILIKE ${addParam(`%${q}%`)}`)
    if (crmPlatform) conditions.push(`crm_platform = ${addParam(crmPlatform)}`)
    if (comuna) conditions.push(`${addParam(comuna)} = ANY(comunas_operated)`)
    if (onlyWithWeb) conditions.push('web_propia_url IS NOT NULL')
    if (onlyActive) conditions.push('active_listings_count > 0')

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : 'WHERE true'

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM corredoras_cl ${whereClause}`,
      params
    )
    const total = Number(countResult.rows[0]?.total ?? 0)

    const dataParams = [...params, pageSize, offset]
    const result = await pool.query(
      `SELECT
         id,
         advertiser_id,
         COALESCE(name_normalized, name_raw) AS name,
         logo_url,
         phones,
         web_propia_url,
         crm_platform,
         active_listings_count,
         total_listings_seen,
         comunas_operated,
         avg_days_on_market,
         exclusivity_ratio,
         metrics_updated_at,
         first_seen_at,
         last_seen_at
       FROM corredoras_cl
       ${whereClause}
       ORDER BY ${SORT_CLAUSES[sort]}
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    )

    return NextResponse.json({
      success: true,
      count: result.rows.length,
      total,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      data: result.rows,
    })
  } catch (error) {
    console.error('Error fetching corredoras_cl:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
