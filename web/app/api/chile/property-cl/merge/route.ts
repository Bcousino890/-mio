import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { mergePropertiesCl } from '@/lib/property-cl-merge'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chile/property-cl/merge — unir a mano N propiedades canónicas en
// una sola (matching manual, migración 0078).
//
// El dedup automático no llega al 100%: cuando el equipo ve que dos fichas son
// el mismo inmueble (mismas fotos, misma casa, distinta corredora), lo arregla
// desde /chile/propiedades arrastrando una ficha sobre otra o seleccionando
// varias y uniéndolas. Ahí no hay fallo, así que la decisión pesa más que el
// score: queda blindada contra el próximo barrido del dedup (ver
// lib/property-cl-merge.ts).
//
// Body: { ids: string[], survivor_id?: string, note?: string }
//   - ids:          propiedades a unir (>= 2).
//   - survivor_id:  cuál conserva su ficha/ref_code. Por defecto, la que más
//                   anuncios tiene (mismo criterio determinista del clustering).
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  let body: { ids?: unknown; survivor_id?: unknown; note?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Body inválido' }, { status: 400 })
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === 'string' && v.length > 0) : []
  if (ids.length < 2) {
    return NextResponse.json({ success: false, error: 'Hay que indicar al menos 2 propiedades para unir' }, { status: 400 })
  }
  const survivorId = typeof body.survivor_id === 'string' ? body.survivor_id : null
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await mergePropertiesCl(client, { ids, survivorId, note })
    await client.query('COMMIT')
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('Error uniendo property_cl a mano:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    // Los errores de validación del helper (menos de 2 propiedades, alguna ya
    // no existe) son culpa del pedido, no del servidor.
    const isClientError = /al menos 2|ya no existe/i.test(message)
    return NextResponse.json({ success: false, error: message }, { status: isClientError ? 400 : 500 })
  } finally {
    client.release()
  }
}
