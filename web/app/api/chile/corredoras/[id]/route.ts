import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// /api/chile/corredoras/[id] — ficha de una corredora (plan Anuncios CL · H4).
// Su identidad + métricas + el INVENTARIO: las propiedades canónicas
// (property_cl) que publica, marcando cuáles comparte con otras corredoras
// (en canje / sin exclusividad). El inventario oculto de la web propia (H21)
// se sumará aquí cuando esa fase esté cableada.
//
// UNA CORREDORA, N CUENTAS: corredoras_cl guarda una fila por cuenta de
// vendedor de Mercado Libre, pero una corredora opera con varias (Property
// Partners tiene 3). La ficha SIEMPRE agrupa todas las cuentas que comparten
// nombre normalizado — si no, mostraba 164 anuncios de los 261 que tiene.
//
// Y las cifras se calculan EN VIVO desde los anuncios, no se leen de las
// métricas guardadas: esas son una foto del último paso del job de dedup y se
// quedaban atrás (marcaban 164 activos cuando el inventario real ya era otro),
// dejando tres números que no cuadraban entre sí en la misma pantalla.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) {
    return NextResponse.json({ success: false, error: 'falta id de corredora' }, { status: 400 })
  }

  try {
    // Todas las cuentas de la MISMA corredora (mismo nombre normalizado).
    const corredoraResult = await pool.query(
      `WITH objetivo AS (
         SELECT COALESCE(name_normalized, name_raw) AS gname FROM corredoras_cl WHERE id = $1
       ),
       grupo AS (
         SELECT c.* FROM corredoras_cl c, objetivo o
         WHERE COALESCE(c.name_normalized, c.name_raw) = o.gname
       )
       SELECT
         (SELECT id FROM grupo ORDER BY active_listings_count DESC NULLS LAST LIMIT 1) AS id,
         (SELECT gname FROM objetivo) AS name,
         (SELECT array_agg(DISTINCT advertiser_id) FROM grupo WHERE advertiser_id IS NOT NULL) AS advertiser_ids,
         (SELECT count(*)::int FROM grupo) AS accounts,
         (SELECT advertiser_id FROM grupo ORDER BY active_listings_count DESC NULLS LAST LIMIT 1) AS advertiser_id,
         (SELECT logo_url FROM grupo WHERE logo_url IS NOT NULL ORDER BY active_listings_count DESC NULLS LAST LIMIT 1) AS logo_url,
         (SELECT web_propia_url FROM grupo WHERE web_propia_url IS NOT NULL LIMIT 1) AS web_propia_url,
         (SELECT crm_platform FROM grupo ORDER BY (crm_platform <> 'unknown') DESC LIMIT 1) AS crm_platform,
         (SELECT array_agg(DISTINCT t) FROM grupo g CROSS JOIN LATERAL unnest(COALESCE(g.phones,'{}')) t) AS phones,
         (SELECT array_agg(DISTINCT t) FROM grupo g CROSS JOIN LATERAL unnest(COALESCE(g.comunas_operated,'{}')) t) AS comunas_operated,
         (SELECT max(metrics_updated_at) FROM grupo) AS metrics_updated_at,
         (SELECT min(first_seen_at) FROM grupo) AS first_seen_at,
         (SELECT max(last_seen_at) FROM grupo) AS last_seen_at,
         (SELECT sum(avg_days_on_market * active_listings_count) FILTER (WHERE avg_days_on_market IS NOT NULL)
                 / NULLIF(sum(active_listings_count) FILTER (WHERE avg_days_on_market IS NOT NULL), 0) FROM grupo) AS avg_days_on_market,
         (SELECT sum(exclusivity_ratio * active_listings_count) FILTER (WHERE exclusivity_ratio IS NOT NULL)
                 / NULLIF(sum(active_listings_count) FILTER (WHERE exclusivity_ratio IS NOT NULL), 0) FROM grupo) AS exclusivity_ratio
       WHERE EXISTS (SELECT 1 FROM objetivo)`,
      [id]
    )
    if (corredoraResult.rows.length === 0 || !corredoraResult.rows[0].name) {
      return NextResponse.json({ success: false, error: 'corredora no encontrada' }, { status: 404 })
    }
    const corredora = corredoraResult.rows[0]

    // Ids de TODAS las cuentas del grupo (para el inventario) y el histórico
    // real de anuncios vistos, contado en vivo sobre esas cuentas.
    const groupRes = await pool.query(
      `WITH objetivo AS (
         SELECT COALESCE(name_normalized, name_raw) AS gname FROM corredoras_cl WHERE id = $1
       )
       SELECT c.id FROM corredoras_cl c, objetivo o
       WHERE COALESCE(c.name_normalized, c.name_raw) = o.gname`,
      [id]
    )
    const groupIds: string[] = groupRes.rows.map((r) => r.id)
    const seenRes = await pool.query(
      `SELECT count(*)::int AS n FROM listings_cl WHERE corredora_id = ANY($1::uuid[])`,
      [groupIds]
    )
    const totalSeen = seenRes.rows[0]?.n ?? 0

    // Inventario: propiedades canónicas donde esta corredora tiene al menos un
    // anuncio. `shared_corredora_count` > 1 = la publica también otra corredora
    // (en canje). `own_price` es el precio del anuncio de ESTA corredora.
    const inventoryResult = await pool.query(
      `SELECT DISTINCT ON (p.id)
         p.id AS property_cl_id,
         p.operation,
         p.property_type,
         p.canonical_price,
         p.square_meters,
         p.bedrooms,
         p.bathrooms,
         p.location_confidence,
         c.name AS comuna_name,
         p.corredora_count AS shared_corredora_count,
         (p.corredora_count > 1) AS shared,
         l.price AS own_price,
         l.external_id AS own_external_id,
         l.source_url AS own_source_url,
         l.is_active AS own_is_active,
         l.seller_reference,
         l.photos->>0 AS own_cover_photo
       FROM listings_cl l
       JOIN property_cl p ON p.id = l.property_cl_id
       LEFT JOIN chile_comunas c ON c.id = p.comuna_id
       -- TODAS las cuentas de la corredora, no solo la del id pedido.
       WHERE l.corredora_id = ANY($1::uuid[])
       ORDER BY p.id, l.is_active DESC, l.last_seen_at DESC`,
      [groupIds]
    )

    const inventory = inventoryResult.rows
    // Stock activo EN VIVO, del mismo conjunto que se está listando: así el
    // titular y el inventario no pueden decir cosas distintas.
    const activos = inventory.filter((r) => r.own_is_active)
    return NextResponse.json({
      success: true,
      data: {
        ...corredora,
        // Sustituyen a las métricas guardadas (que iban con retraso).
        active_listings_count: activos.length,
        total_listings_seen: Number(totalSeen),
        inventory,
        inventory_count: inventory.length,
        active_count: activos.length,
        shared_count: inventory.filter((r) => r.shared).length,
      },
    }, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' },
    })
  } catch (error) {
    console.error('Error fetching corredora detail:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
