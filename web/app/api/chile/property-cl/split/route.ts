import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { splitListingsCl } from '@/lib/property-cl-merge'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chile/property-cl/split — sacar anuncios de una propiedad canónica
// a una ficha nueva (migración 0078).
//
// Es el reverso de /merge y la forma de deshacer un agrupamiento equivocado,
// venga del dedup automático o de una unión manual anterior. Los anuncios NO se
// borran: se mudan a un property_cl nuevo, y el par separado queda como
// 'rejected' humano en listing_match_cl para que el clustering no lo vuelva a
// juntar.
//
// Body: { property_id: string, listing_ids: string[], note?: string }
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  let body: { property_id?: unknown; listing_ids?: unknown; note?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Body inválido' }, { status: 400 })
  }

  const propertyId = typeof body.property_id === 'string' ? body.property_id : null
  const listingIds = Array.isArray(body.listing_ids)
    ? body.listing_ids.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : []
  if (!propertyId || listingIds.length === 0) {
    return NextResponse.json({ success: false, error: 'Faltan property_id o listing_ids' }, { status: 400 })
  }
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await splitListingsCl(client, { propertyId, listingIds, note })
    await client.query('COMMIT')
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('Error separando anuncios de property_cl:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    const isClientError = /no encontrada|no pertenecen|quedaría vacía|No se indicó/i.test(message)
    return NextResponse.json({ success: false, error: message }, { status: isClientError ? 400 : 500 })
  } finally {
    client.release()
  }
}
