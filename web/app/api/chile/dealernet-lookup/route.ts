import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import {
  parseRut,
  isValidRut,
  queryDealernet,
  DEFAULT_DEALERNET_PRODUCTS,
  DEALERNET_PRODUCTS,
  dealernetRetcodeMessage,
  type DealernetPhone,
} from '@/lib/dealernet'
import { getCachedContactByRut } from '@/lib/dealernet-cache'

const VALID_PRODUCT_CODES = new Set(Object.values(DEALERNET_PRODUCTS))

// Mismo teléfono puede salir de varios productos (3407/3408/3410) — para la
// UI lo mostramos una vez, marcando todas las fuentes que lo confirmaron.
function dedupePhones(phones: DealernetPhone[]) {
  const map = new Map<string, DealernetPhone & { sources: string[] }>()
  for (const p of phones) {
    const existing = map.get(p.phone_e164)
    if (!existing) {
      map.set(p.phone_e164, { ...p, sources: [p.product_code] })
      continue
    }
    existing.sources.push(p.product_code)
    if (p.categoria === 'probable') existing.categoria = 'probable'
    existing.ranking = Math.max(existing.ranking ?? 0, p.ranking ?? 0)
    existing.calidad = Math.max(existing.calidad ?? 0, p.calidad ?? 0)
    existing.ind_whatsapp = existing.ind_whatsapp || p.ind_whatsapp
    existing.idimagen = existing.idimagen ?? p.idimagen
    existing.relacion = existing.relacion ?? p.relacion
  }
  return Array.from(map.values())
}

export async function POST(request: NextRequest) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'JSON inválido' }, { status: 400 })
  }

  const rutInput = String(body?.rut ?? '').trim()
  const siiRol = body?.sii_rol ? String(body.sii_rol) : null
  const siiComunaCode = body?.sii_comuna_code ? String(body.sii_comuna_code) : null
  const portalUrl = body?.portal_url ? String(body.portal_url).trim() : null
  const notes = body?.notes ? String(body.notes).trim() : null
  const force = body?.force === true

  // product_codes: array of '3407'|'3408'|'3410' — defaults to all three
  const rawCodes = Array.isArray(body?.product_codes) ? body.product_codes : null
  const productCodes: string[] = rawCodes
    ? rawCodes.filter((c: unknown) => typeof c === 'string' && VALID_PRODUCT_CODES.has(c as any))
    : DEFAULT_DEALERNET_PRODUCTS
  if (productCodes.length === 0) {
    return NextResponse.json({ success: false, error: 'Selecciona al menos un producto' }, { status: 400 })
  }

  const rut = parseRut(rutInput)
  if (!rut) {
    return NextResponse.json({ success: false, error: 'RUT inválido' }, { status: 400 })
  }
  if (!isValidRut(rut)) {
    return NextResponse.json({ success: false, error: 'Dígito verificador no coincide' }, { status: 400 })
  }

  // Cada consulta a DealerNet tiene costo — si ya tenemos una respuesta
  // exitosa guardada que cubre todos los productos pedidos, se reusa en vez
  // de volver a golpear el web service. `force` (botón "Actualizar") salta
  // este chequeo a propósito.
  if (!force) {
    const cached = await getCachedContactByRut(rut.num, rut.dv, productCodes)
    if (cached) {
      // sii_rol/sii_comuna_code de este contacto puede quedar corto si el
      // mismo RUT ya se había guardado desde otra búsqueda — se completa acá
      // para no perder la asociación rol↔propietario de esta ficha.
      if (siiRol && siiComunaCode && (!cached.contact.sii_rol || !cached.contact.sii_comuna_code)) {
        await pool.query(
          `UPDATE dealernet_contacts_cl SET sii_rol = COALESCE(sii_rol, $2), sii_comuna_code = COALESCE(sii_comuna_code, $3) WHERE id = $1`,
          [cached.contact.id, siiRol, siiComunaCode]
        )
      }
      return NextResponse.json({
        success: true,
        contact_id: cached.contact.id,
        retcode: cached.contact.retcode,
        retmsg: cached.contact.retmsg,
        nombre_titular: cached.contact.nombre_titular,
        phones: dedupePhones(cached.phones),
        addresses: cached.addresses,
        emails: cached.emails,
        relacionados: cached.relacionados,
        rut_num: rut.num,
        rut_dv: rut.dv,
        from_cache: true,
      })
    }
  }

  let lookup
  try {
    lookup = await queryDealernet(rut, productCodes)
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error consultando DealerNet' },
      { status: 502 }
    )
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const contactRes = await client.query(
      `INSERT INTO dealernet_contacts_cl
         (rut_num, rut_dv, sii_rol, sii_comuna_code, nombre_titular, products_requested, retcode, retmsg, raw_response, portal_url, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (rut_num, rut_dv) DO UPDATE SET
         sii_rol = COALESCE(EXCLUDED.sii_rol, dealernet_contacts_cl.sii_rol),
         sii_comuna_code = COALESCE(EXCLUDED.sii_comuna_code, dealernet_contacts_cl.sii_comuna_code),
         nombre_titular = COALESCE(EXCLUDED.nombre_titular, dealernet_contacts_cl.nombre_titular),
         products_requested = ARRAY(
           SELECT DISTINCT unnest(dealernet_contacts_cl.products_requested || EXCLUDED.products_requested)
         ),
         retcode = EXCLUDED.retcode,
         retmsg = EXCLUDED.retmsg,
         raw_response = EXCLUDED.raw_response,
         portal_url = COALESCE(EXCLUDED.portal_url, dealernet_contacts_cl.portal_url),
         notes = COALESCE(EXCLUDED.notes, dealernet_contacts_cl.notes)
       RETURNING id`,
      [
        rut.num,
        rut.dv,
        siiRol,
        siiComunaCode,
        lookup.nombreTitular,
        lookup.productsRequested,
        lookup.retcode,
        lookup.retmsg,
        JSON.stringify(lookup.raw),
        portalUrl,
        notes,
      ]
    )
    const contactId = contactRes.rows[0].id

    for (const phone of lookup.phones) {
      await client.query(
        `INSERT INTO dealernet_phones_cl
           (contact_id, phone_e164, phone_raw, categoria, clasificacion, ind_whatsapp, idimagen, relacion, ranking, calidad, product_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (contact_id, phone_e164, product_code) DO UPDATE SET
           categoria = EXCLUDED.categoria,
           clasificacion = EXCLUDED.clasificacion,
           ind_whatsapp = EXCLUDED.ind_whatsapp,
           idimagen = EXCLUDED.idimagen,
           relacion = COALESCE(EXCLUDED.relacion, dealernet_phones_cl.relacion),
           ranking = EXCLUDED.ranking,
           calidad = EXCLUDED.calidad`,
        [
          contactId,
          phone.phone_e164,
          phone.phone_raw,
          phone.categoria,
          phone.clasificacion,
          phone.ind_whatsapp,
          phone.idimagen,
          phone.relacion,
          phone.ranking,
          phone.calidad,
          phone.product_code,
        ]
      )
    }

    for (const rel of lookup.relacionados) {
      await client.query(
        `INSERT INTO dealernet_relacionados_cl
           (contact_id, rut_num, rut_dv, nombre, relacion, product_code)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (contact_id, COALESCE(rut_num, 0), COALESCE(nombre, ''), COALESCE(relacion, '')) DO UPDATE SET
           rut_dv = COALESCE(EXCLUDED.rut_dv, dealernet_relacionados_cl.rut_dv)`,
        [contactId, rel.rut, rel.dv, rel.nombre, rel.relacion, rel.product_code]
      )
    }

    for (const addr of lookup.addresses) {
      await client.query(
        `INSERT INTO dealernet_addresses_cl
           (contact_id, direccion, ubicacion, rol, categoria, ranking, calidad, product_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (contact_id, direccion, product_code) DO UPDATE SET
           ubicacion = EXCLUDED.ubicacion,
           rol = EXCLUDED.rol,
           categoria = EXCLUDED.categoria,
           ranking = EXCLUDED.ranking,
           calidad = EXCLUDED.calidad`,
        [contactId, addr.direccion, addr.ubicacion, addr.rol, addr.categoria, addr.ranking, addr.calidad, addr.product_code]
      )
    }

    for (const email of lookup.emails) {
      await client.query(
        `INSERT INTO dealernet_emails_cl
           (contact_id, email, categoria, ranking, calidad, product_code)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (contact_id, email, product_code) DO UPDATE SET
           categoria = EXCLUDED.categoria,
           ranking = EXCLUDED.ranking,
           calidad = EXCLUDED.calidad`,
        [contactId, email.email, email.categoria, email.ranking, email.calidad, email.product_code]
      )
    }

    await client.query('COMMIT')

    // DealerNet responde HTTP 200 aun cuando la consulta falló (cuenta no
    // habilitada, clave inválida, etc.) — igual que en dealernet-buscar. Se
    // guarda el retcode/retmsg en BD para auditoría, pero se reporta el error
    // real al cliente en vez de un "0 teléfonos" silencioso.
    const retcodeError = dealernetRetcodeMessage(lookup.retcode)
    if (retcodeError) {
      return NextResponse.json({
        success: false,
        error: `DealerNet: ${retcodeError}${lookup.retmsg ? ` (${lookup.retmsg})` : ''}`,
        retcode: lookup.retcode,
      }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      contact_id: contactId,
      retcode: lookup.retcode,
      retmsg: lookup.retmsg,
      nombre_titular: lookup.nombreTitular,
      phones: dedupePhones(lookup.phones),
      addresses: lookup.addresses,
      emails: lookup.emails,
      relacionados: lookup.relacionados,
      rut_num: rut.num,
      rut_dv: rut.dv,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error guardando resultado' },
      { status: 500 }
    )
  } finally {
    client.release()
  }
}

// Lee el último resultado guardado (cache) para no volver a golpear DealerNet
// cada vez que se abre la ficha del rol.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const siiRol = sp.get('sii_rol')?.trim()
  const siiComunaCode = sp.get('sii_comuna_code')?.trim()
  const rutParam = sp.get('rut')?.trim()

  try {
    let contactRow
    if (rutParam) {
      const rut = parseRut(rutParam)
      if (!rut) return NextResponse.json({ success: false, error: 'RUT inválido' }, { status: 400 })
      const r = await pool.query(
        `SELECT * FROM dealernet_contacts_cl WHERE rut_num = $1 AND rut_dv = $2 LIMIT 1`,
        [rut.num, rut.dv]
      )
      contactRow = r.rows[0]
    } else if (siiRol && siiComunaCode) {
      const r = await pool.query(
        `SELECT * FROM dealernet_contacts_cl WHERE sii_rol = $1 AND sii_comuna_code = $2 ORDER BY updated_at DESC LIMIT 1`,
        [siiRol, siiComunaCode]
      )
      contactRow = r.rows[0]
    } else {
      return NextResponse.json({ success: false, error: 'rut o (sii_rol + sii_comuna_code) requerido' }, { status: 400 })
    }

    if (!contactRow) {
      return NextResponse.json({ success: true, contact: null })
    }

    const [phonesRes, addressesRes, emailsRes, relacionadosRes] = await Promise.all([
      pool.query(`SELECT * FROM dealernet_phones_cl WHERE contact_id = $1 ORDER BY categoria, ranking DESC NULLS LAST`, [contactRow.id]),
      pool.query(`SELECT * FROM dealernet_addresses_cl WHERE contact_id = $1 ORDER BY categoria, ranking DESC NULLS LAST`, [contactRow.id]),
      pool.query(`SELECT * FROM dealernet_emails_cl WHERE contact_id = $1 ORDER BY categoria, ranking DESC NULLS LAST`, [contactRow.id]),
      pool.query(`SELECT * FROM dealernet_relacionados_cl WHERE contact_id = $1 ORDER BY relacion, nombre`, [contactRow.id]),
    ])

    return NextResponse.json({
      success: true,
      contact: contactRow,
      phones: phonesRes.rows,
      addresses: addressesRes.rows,
      emails: emailsRes.rows,
      relacionados: relacionadosRes.rows,
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
