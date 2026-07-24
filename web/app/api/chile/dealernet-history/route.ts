import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Historial de consultas DealerNet (apartado del Dealer).
//
// Reúne TODO lo que se ha consultado en DealerNet, que queda guardado
// permanentemente en la base, de dos tipos:
//
//   • kind = 'contacto'  → consulta por RUT (dealernet_contacts_cl + hijas):
//     teléfonos, correos, direcciones, relacionados, servicios pedidos,
//     link del portal y notas.
//   • kind = 'busqueda'  → Buscador Múltiple por dirección/rol/nombre…
//     (dealernet_buscador_multiple_cl): los candidatos devueltos.
//
// Endpoints:
//   GET /api/chile/dealernet-history              → lista unificada (resumen)
//   GET /api/chile/dealernet-history?q=...         → filtra por nombre/RUT/args
//   GET /api/chile/dealernet-history?id=<uuid>     → ficha COMPLETA (contacto)
//   GET /api/chile/dealernet-history?busqueda_id=  → candidatos (Buscador Múltiple)
//
// El detalle del contacto se devuelve ya normalizado al shape que consume la
// ficha (web/components/chile/DealerFicha.tsx).

const MAX_LIMIT = 200

const TIPBUSQ_LABELS: Record<string, string> = {
  direccion: 'Dirección',
  rol: 'Rol',
  nombre: 'Nombre',
  empresa: 'Empresa',
  telefono: 'Teléfono',
  patente: 'Patente',
  ambas_peremp: 'Persona/Empresa',
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const id = sp.get('id')?.trim()
  const busquedaId = sp.get('busqueda_id')?.trim()

  try {
    // ── Detalle contacto: ficha completa de una consulta por RUT ─────────────
    if (id) {
      const contactRes = await pool.query(
        `SELECT * FROM dealernet_contacts_cl WHERE id = $1 LIMIT 1`,
        [id]
      )
      const contact = contactRes.rows[0]
      if (!contact) {
        return NextResponse.json({ success: false, error: 'Consulta no encontrada' }, { status: 404 })
      }

      const [phonesRes, addressesRes, emailsRes, relacionadosRes] = await Promise.all([
        pool.query(`SELECT * FROM dealernet_phones_cl WHERE contact_id = $1 ORDER BY categoria, ranking DESC NULLS LAST`, [id]),
        pool.query(`SELECT * FROM dealernet_addresses_cl WHERE contact_id = $1 ORDER BY categoria, ranking DESC NULLS LAST`, [id]),
        pool.query(`SELECT * FROM dealernet_emails_cl WHERE contact_id = $1 ORDER BY categoria, ranking DESC NULLS LAST`, [id]),
        pool.query(`SELECT * FROM dealernet_relacionados_cl WHERE contact_id = $1 ORDER BY relacion, nombre`, [id]),
      ])

      return NextResponse.json({
        success: true,
        detail: {
          id: contact.id,
          rut_num: Number(contact.rut_num),
          rut_dv: contact.rut_dv,
          nombre_titular: contact.nombre_titular,
          sii_rol: contact.sii_rol,
          sii_comuna_code: contact.sii_comuna_code,
          products_requested: contact.products_requested ?? [],
          retcode: contact.retcode,
          retmsg: contact.retmsg,
          portal_url: contact.portal_url,
          notes: contact.notes,
          created_at: contact.created_at,
          updated_at: contact.updated_at,
          // Ya normalizado al shape de DealerFicha:
          phones: phonesRes.rows.map(p => ({
            phone_e164: p.phone_e164,
            phone_raw: p.phone_raw,
            categoria: p.categoria,
            clasificacion: p.clasificacion,
            ind_whatsapp: p.ind_whatsapp,
            idimagen: p.idimagen,
            relacion: p.relacion,
            ranking: p.ranking != null ? Number(p.ranking) : null,
          })),
          addresses: addressesRes.rows.map(a => ({
            direccion: a.direccion,
            ubicacion: a.ubicacion,
            categoria: a.categoria,
            ranking: a.ranking != null ? Number(a.ranking) : null,
          })),
          emails: emailsRes.rows.map(e => ({
            email: e.email,
            categoria: e.categoria,
            ranking: e.ranking != null ? Number(e.ranking) : null,
          })),
          relacionados: relacionadosRes.rows.map(r => ({
            rut: r.rut_num != null ? Number(r.rut_num) : null,
            dv: r.rut_dv,
            nombre: r.nombre,
            relacion: r.relacion,
          })),
        },
      })
    }

    // ── Detalle búsqueda: candidatos del Buscador Múltiple ───────────────────
    if (busquedaId) {
      const res = await pool.query(
        `SELECT * FROM dealernet_buscador_multiple_cl WHERE id = $1 LIMIT 1`,
        [busquedaId]
      )
      const row = res.rows[0]
      if (!row) {
        return NextResponse.json({ success: false, error: 'Búsqueda no encontrada' }, { status: 404 })
      }
      return NextResponse.json({
        success: true,
        busqueda: {
          id: row.id,
          tipbusq: row.tipbusq,
          tipbusq_label: TIPBUSQ_LABELS[row.tipbusq] ?? row.tipbusq,
          args: row.args,
          retcode: row.retcode,
          retmsg: row.retmsg,
          candidatos: row.candidatos ?? [],
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
      })
    }

    // ── Lista unificada: contactos + búsquedas, ordenados por fecha ───────────
    const q = sp.get('q')?.trim() || null
    const limit = Math.min(Math.max(Number(sp.get('limit')) || 50, 1), MAX_LIMIT)
    const offset = Math.max(Number(sp.get('offset')) || 0, 0)
    const qDigits = q ? q.replace(/[^0-9kK]/g, '') : null

    const params: unknown[] = []
    let where = ''
    if (q) {
      params.push(`%${q}%`)                        // $1 — nombre / args
      params.push(qDigits ? `%${qDigits}%` : '%')  // $2 — rut concatenado
      where = `WHERE (
          t.nombre_titular ILIKE $1
          OR t.args ILIKE $1
          OR (COALESCE(t.rut_num::text, '') || COALESCE(t.rut_dv, '')) ILIKE $2
        )`
    }
    params.push(limit)
    params.push(offset)

    const unionSql = `
      SELECT
        'contacto'::text AS kind,
        c.id, c.updated_at, c.created_at,
        c.nombre_titular, c.rut_num, c.rut_dv, c.products_requested,
        c.retcode, c.portal_url, c.notes, c.sii_rol,
        NULL::text AS tipbusq, NULL::text AS args,
        (SELECT count(*) FROM dealernet_phones_cl p WHERE p.contact_id = c.id)::int        AS phones_n,
        (SELECT count(*) FROM dealernet_emails_cl e WHERE e.contact_id = c.id)::int        AS emails_n,
        (SELECT count(*) FROM dealernet_addresses_cl a WHERE a.contact_id = c.id)::int     AS addresses_n,
        (SELECT count(*) FROM dealernet_relacionados_cl r WHERE r.contact_id = c.id)::int  AS relacionados_n,
        0::int AS candidatos_n
      FROM dealernet_contacts_cl c
      UNION ALL
      SELECT
        'busqueda'::text AS kind,
        b.id, b.updated_at, b.created_at,
        NULL::text, NULL::bigint, NULL::text, NULL::text[],
        b.retcode, NULL::text, NULL::text, NULL::text,
        b.tipbusq, b.args,
        0::int, 0::int, 0::int, 0::int,
        COALESCE(jsonb_array_length(b.candidatos), 0)::int AS candidatos_n
      FROM dealernet_buscador_multiple_cl b`

    const listRes = await pool.query(
      `SELECT * FROM (${unionSql}) t
       ${where}
       ORDER BY t.updated_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    const totalRes = await pool.query(
      `SELECT count(*)::int AS n FROM (${unionSql}) t ${where}`,
      q ? params.slice(0, 2) : []
    )

    const items = listRes.rows.map(r => {
      const base = {
        kind: r.kind as 'contacto' | 'busqueda',
        id: r.id,
        retcode: r.retcode,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }
      if (r.kind === 'busqueda') {
        return {
          ...base,
          tipbusq: r.tipbusq,
          tipbusq_label: TIPBUSQ_LABELS[r.tipbusq] ?? r.tipbusq,
          args: r.args,
          candidatos_n: Number(r.candidatos_n),
        }
      }
      return {
        ...base,
        rut_num: Number(r.rut_num),
        rut_dv: r.rut_dv,
        nombre_titular: r.nombre_titular,
        products_requested: r.products_requested ?? [],
        sii_rol: r.sii_rol,
        portal_url: r.portal_url,
        notes: r.notes,
        phones_n: Number(r.phones_n),
        emails_n: Number(r.emails_n),
        addresses_n: Number(r.addresses_n),
        relacionados_n: Number(r.relacionados_n),
      }
    })

    return NextResponse.json({
      success: true,
      total: totalRes.rows[0]?.n ?? items.length,
      limit,
      offset,
      items,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 500 }
    )
  }
}
