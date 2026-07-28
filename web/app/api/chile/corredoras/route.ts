import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// /api/chile/corredoras — entidad corredora consolidada (plan Anuncios CL · H4).
// Lista las corredoras con sus métricas derivadas (stock activo, rotación,
// exclusividad, comunas de operación). La ficha individual con su inventario
// vive en /api/chile/corredoras/[id].
//
// UNA CORREDORA, N CUENTAS. corredoras_cl guarda una fila por `advertiser_id`
// (cuenta de vendedor de Mercado Libre), pero una misma corredora opera con
// VARIAS: Property Partners usa 4 y aparecía partida en fichas de 288/50/47/…
// mientras el portal la muestra entera.
//
// La fusión es EXPLÍCITA (corredora_merge_names_cl, migración 0081): solo se
// unifican las corredoras listadas ahí. Fusionar por nombre automáticamente
// parece obvio y es un error — probado sobre los datos reales unía "Sin
// Información" (3 vendedores sin relación), nombres de pila como "Felipe" o
// "Cristian", y sobre todo rompería las franquicias (Coldwell Banker, Engel &
// Völkers), que son oficinas independientes con el mismo nombre.
// ─────────────────────────────────────────────────────────────────────────────

const SORT_CLAUSES: Record<string, string> = {
  stock: 'active_listings_count DESC',
  total: 'total_listings_seen DESC',
  rotacion: 'avg_days_on_market ASC NULLS LAST',
  exclusividad: 'exclusivity_ratio DESC NULLS LAST',
  nombre: 'name ASC NULLS LAST',
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
    if (q) conditions.push(`c.name_normalized ILIKE ${addParam(`%${q}%`)}`)
    if (crmPlatform) conditions.push(`c.crm_platform = ${addParam(crmPlatform)}`)
    if (comuna) conditions.push(`${addParam(comuna)} = ANY(c.comunas_operated)`)
    if (onlyWithWeb) conditions.push('c.web_propia_url IS NOT NULL')

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : 'WHERE true'
    // "Solo con stock activo" se aplica DESPUÉS de sumar el grupo y con el
    // conteo en vivo: una cuenta puede estar a 0 y la corredora seguir teniendo
    // stock en otra, y la métrica guardada va con retraso.
    const havingActive = onlyActive ? 'WHERE active_listings_count > 0' : ''

    // La corredora agrupada (por nombre normalizado) es la unidad de esta lista:
    // cuenta corredoras reales, no cuentas de vendedor.
    // `array_agg` no puede acumular arrays de distinta longitud, así que las
    // comunas y los teléfonos se desanidan ANTES de agrupar, en su propio CTE.
    const groupedCte = `
      WITH stock AS (
        -- Conteo EN VIVO desde los anuncios. active_listings_count/
        -- total_listings_seen de corredoras_cl son una foto del último paso del
        -- job de dedup y se quedan atrás: para Property Partners marcaban 263
        -- cuando el real era 288 (el portal declara 290). Además dejaban al
        -- directorio y a la ficha —que sí cuenta en vivo— diciendo cosas
        -- distintas de la misma corredora.
        SELECT corredora_id,
               count(*) FILTER (WHERE is_active)::int AS activos,
               count(*)::int AS vistos
        FROM listings_cl
        WHERE corredora_id IS NOT NULL
        GROUP BY corredora_id
      ),
      base AS (
        -- gname = clave de agrupación. Solo las corredoras de la lista explícita
        -- comparten clave entre cuentas; el resto se agrupa consigo misma (su
        -- propio id), así que sigue siendo una fila por cuenta.
        SELECT c.*,
               CASE WHEN m.name_normalized IS NOT NULL
                    THEN COALESCE(c.name_normalized, c.name_raw)
                    ELSE c.id::text END AS gname,
               COALESCE(s.activos, 0) AS activos_vivo,
               COALESCE(s.vistos, 0) AS vistos_vivo
        FROM corredoras_cl c
        LEFT JOIN stock s ON s.corredora_id = c.id
        LEFT JOIN corredora_merge_names_cl m
          ON m.name_normalized = COALESCE(c.name_normalized, c.name_raw)
        ${whereClause}
      ),
      comunas AS (
        SELECT gname, array_agg(DISTINCT t) AS comunas_operated
        FROM base CROSS JOIN LATERAL unnest(COALESCE(base.comunas_operated, '{}')) t
        GROUP BY gname
      ),
      tels AS (
        SELECT gname, array_agg(DISTINCT t) AS phones
        FROM base CROSS JOIN LATERAL unnest(COALESCE(base.phones, '{}')) t
        GROUP BY gname
      ),
      agrupadas AS (
        SELECT
          (array_agg(COALESCE(b.name_normalized, b.name_raw) ORDER BY b.activos_vivo DESC NULLS LAST))[1] AS name,
          -- id representativo: la cuenta con más stock (la "principal"), para
          -- que el enlace a la ficha lleve a la más relevante del grupo.
          (array_agg(b.id ORDER BY b.activos_vivo DESC NULLS LAST))[1] AS id,
          array_agg(DISTINCT b.advertiser_id) FILTER (WHERE b.advertiser_id IS NOT NULL) AS advertiser_ids,
          count(*)::int AS accounts,
          (array_agg(b.logo_url ORDER BY b.activos_vivo DESC NULLS LAST)
             FILTER (WHERE b.logo_url IS NOT NULL))[1] AS logo_url,
          (array_agg(b.web_propia_url) FILTER (WHERE b.web_propia_url IS NOT NULL))[1] AS web_propia_url,
          (array_agg(b.crm_platform ORDER BY (b.crm_platform <> 'unknown') DESC))[1] AS crm_platform,
          COALESCE(sum(b.activos_vivo), 0)::int AS active_listings_count,
          COALESCE(sum(b.vistos_vivo), 0)::int AS total_listings_seen,
          co.comunas_operated,
          te.phones,
          -- Medias PONDERADAS por stock: sin peso, una cuenta de 3 anuncios
          -- pesaría igual que una de 164.
          CASE WHEN sum(b.activos_vivo) FILTER (WHERE b.avg_days_on_market IS NOT NULL) > 0
               THEN sum(b.avg_days_on_market * b.activos_vivo) FILTER (WHERE b.avg_days_on_market IS NOT NULL)
                    / sum(b.activos_vivo) FILTER (WHERE b.avg_days_on_market IS NOT NULL)
          END AS avg_days_on_market,
          CASE WHEN sum(b.activos_vivo) FILTER (WHERE b.exclusivity_ratio IS NOT NULL) > 0
               THEN sum(b.exclusivity_ratio * b.activos_vivo) FILTER (WHERE b.exclusivity_ratio IS NOT NULL)
                    / sum(b.activos_vivo) FILTER (WHERE b.exclusivity_ratio IS NOT NULL)
          END AS exclusivity_ratio,
          max(b.metrics_updated_at) AS metrics_updated_at,
          min(b.first_seen_at) AS first_seen_at,
          max(b.last_seen_at) AS last_seen_at
        FROM base b
        LEFT JOIN comunas co ON co.gname = b.gname
        LEFT JOIN tels te ON te.gname = b.gname
        GROUP BY b.gname, co.comunas_operated, te.phones
      )`

    const countResult = await pool.query(
      `${groupedCte} SELECT COUNT(*) AS total FROM agrupadas ${havingActive}`,
      params
    )
    const total = Number(countResult.rows[0]?.total ?? 0)

    const dataParams = [...params, pageSize, offset]
    const result = await pool.query(
      `${groupedCte}
       -- Sin metrics_updated_at/first_seen_at/last_seen_at: el directorio no los
       -- pinta y son ~50KB de payload en 800+ corredoras (los trae la ficha).
       SELECT id, advertiser_ids, accounts, name, logo_url, phones, web_propia_url,
              crm_platform, active_listings_count, total_listings_seen,
              comunas_operated, avg_days_on_market, exclusivity_ratio
       FROM agrupadas
       ${havingActive}
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
    }, {
      // Las métricas de corredora las recalcula el job de dedup cada 15 min, así
      // que servir hasta 60s de antigüedad no cambia nada de lo que se ve y hace
      // que volver al directorio sea instantáneo en vez de re-descargar ~350KB.
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' },
    })
  } catch (error) {
    console.error('Error fetching corredoras_cl:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
