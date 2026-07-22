import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// /api/chile/corredoras/[id] — ficha de una corredora (plan Anuncios CL · H4).
// Su identidad + métricas + el INVENTARIO: las propiedades canónicas
// (property_cl) que publica, marcando cuáles comparte con otras corredoras
// (en canje / sin exclusividad). El inventario oculto de la web propia (H21)
// se sumará aquí cuando esa fase esté cableada.
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
    const corredoraResult = await pool.query(
      `SELECT
         id, advertiser_id,
         COALESCE(name_normalized, name_raw) AS name,
         phones, web_propia_url, crm_platform,
         active_listings_count, total_listings_seen, comunas_operated,
         avg_days_on_market, exclusivity_ratio, metrics_updated_at,
         first_seen_at, last_seen_at
       FROM corredoras_cl WHERE id = $1`,
      [id]
    )
    if (corredoraResult.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'corredora no encontrada' }, { status: 404 })
    }
    const corredora = corredoraResult.rows[0]

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
         l.seller_reference
       FROM listings_cl l
       JOIN property_cl p ON p.id = l.property_cl_id
       LEFT JOIN chile_comunas c ON c.id = p.comuna_id
       WHERE l.corredora_id = $1
       ORDER BY p.id, l.is_active DESC, l.last_seen_at DESC`,
      [id]
    )

    const inventory = inventoryResult.rows
    return NextResponse.json({
      success: true,
      data: {
        ...corredora,
        inventory,
        inventory_count: inventory.length,
        shared_count: inventory.filter((r) => r.shared).length,
      },
    })
  } catch (error) {
    console.error('Error fetching corredora detail:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
