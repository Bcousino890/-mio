// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chile/smartbc — envía UNA captación al CRM SmartBC.
//
// Es lo que hay detrás del botón "Agregar a Smart" de la ficha. Antes ese botón
// solo escribía una fecha en property_cl.smart_crm_at ("ya la subí a mano",
// migración 0082); ahora hace el alta de verdad contra la API pública v1.
//
// Usa EXACTAMENTE el mismo mapeo que la sincronización automática nocturna
// (web/lib/smartbc/), no una copia: el contrato con SmartBC tiene una sola
// definición en el repo, y lo que se envía desde el botón es idéntico a lo que
// enviaría el sincronizador. Por eso los módulos viven en web/lib y el CLI del
// scraper los importa desde ahí, y no al revés.
//
// PUT /api/chile/smartbc — guarda la selección de contactos SIN enviar nada.
// Se persiste porque, si solo filtrara en el momento del clic, la siguiente
// sincronización automática (la que dispara un cambio de precio) volvería a
// mandar los 12 teléfonos de DealerNet y borraría la curación del equipo.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
// Módulos ESM compartidos con el CLI del scraper: una sola definición del
// contrato con SmartBC en todo el repo (allowJs los resuelve sin tipos).
import { SmartbcClient } from '@/lib/smartbc/client.mjs'
import { buildNormalizer, fetchCatalogo } from '@/lib/smartbc/catalogo.mjs'
import {
  LISTINGS_SQL,
  loadListings,
  planItem,
  recordResult,
} from '@/lib/smartbc/sync.mjs'
import { externalIdFor, FORCEABLE_TEAM_FIELDS } from '@/lib/smartbc/mapper.mjs'

export const runtime = 'nodejs'

/** Una captación con todo lo que el mapper necesita, por id de captación o de propiedad. */
const CAPTACION_SQL = `
SELECT cap.*,
       com.name    AS comuna_name,
       com.region  AS comuna_region,
       p.localidad AS property_localidad,
       -- Mismos dos campos extra que PENDING_SQL en sync.mjs (pin corregido +
       -- superficie de catastro): el botón "Agregar a Smart" tiene que armar
       -- exactamente el mismo bundle que la sincronización automática.
       p.manual_latitude::float8  AS property_manual_latitude,
       p.manual_longitude::float8 AS property_manual_longitude,
       sr.superficie_terreno_m2   AS sii_superficie_terreno_m2,
       s.payload_hash,
       s.last_payload,
       s.synced_at
  FROM captaciones_cl cap
  LEFT JOIN smartbc_sync_cl s ON s.captacion_id = cap.id
  LEFT JOIN property_cl p     ON p.id = cap.property_cl_id
  LEFT JOIN sii_roles_cl sr   ON sr.sii_comuna_code = cap.sii_comuna_code AND sr.rol = cap.sii_rol
  LEFT JOIN LATERAL (
    SELECT c.name, c.region
      FROM chile_comunas c
     WHERE (cap.sii_comuna_code IS NOT NULL AND c.sii_comuna_code = cap.sii_comuna_code)
        OR (cap.sii_comuna_code IS NULL AND c.name = cap.comuna_label)
     LIMIT 1
  ) com ON true
 WHERE cap.id = $1::uuid OR cap.property_cl_id = $1::uuid
 ORDER BY (cap.owner_name IS NOT NULL) DESC, (cap.phones IS NOT NULL) DESC, cap.updated_at DESC
 LIMIT 1
`

type Seleccion = {
  phone: string
  name?: string | null
  contact_type?: string | null
  relationship?: string | null
  rut?: string | null
  has_whatsapp?: boolean | null
  label?: string | null
  is_owner?: boolean
}

/**
 * Valida `force_fields`: solo lo que el equipo pueda pedir desde el botón
 * "Forzar notas y contacto" — ver FORCEABLE_TEAM_FIELDS en mapper.mjs. Un
 * valor fuera de la whitelist (p. ej. `owner.phone`) es un 400, no un valor
 * que se descarta en silencio: si alguien lo pide es porque espera que pase
 * algo, y lo último que queremos es que crea que forzó un campo y no pasó.
 */
function parseForceFields(raw: unknown): string[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) throw new Error('force_fields debe ser una lista')
  for (const f of raw) {
    if (!FORCEABLE_TEAM_FIELDS.includes(f)) {
      throw new Error(`force_fields: "${f}" no es forzable (solo ${FORCEABLE_TEAM_FIELDS.join(', ')})`)
    }
  }
  return raw
}

/** Valida la selección que manda la UI. Un teléfono es obligatorio; el resto, opcional. */
function parseSeleccion(raw: unknown): Seleccion[] | null {
  if (raw == null) return null
  if (!Array.isArray(raw)) throw new Error('contactos debe ser una lista')
  if (raw.length > 20) throw new Error('SmartBC admite como máximo 20 contactos por captación')
  return raw.map((r, i) => {
    const phone = typeof r?.phone === 'string' ? r.phone.trim() : ''
    if (!phone) throw new Error(`contactos[${i}]: falta el teléfono`)
    return {
      phone,
      name: r?.name ?? null,
      contact_type: r?.contact_type ?? null,
      relationship: r?.relationship ?? null,
      rut: r?.rut ?? null,
      has_whatsapp: typeof r?.has_whatsapp === 'boolean' ? r.has_whatsapp : null,
      label: r?.label ?? null,
      is_owner: r?.is_owner === true,
    }
  })
}

async function cargarCaptacion(id: string) {
  const { rows } = await pool.query(CAPTACION_SQL, [id])
  return rows[0] ?? null
}

/**
 * PUT — guarda la selección de contactos, sin enviar nada al CRM.
 * Body: { id, contactos: [{ phone, name, ... }], by? }
 */
export async function PUT(request: NextRequest) {
  try {
    const { id, contactos, by } = await request.json()
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ success: false, error: 'Falta id' }, { status: 400 })
    }
    const seleccion = parseSeleccion(contactos)

    const cap = await cargarCaptacion(id)
    if (!cap) return NextResponse.json({ success: false, error: 'Captación no encontrada' }, { status: 404 })

    const { rows } = await pool.query(
      `UPDATE captaciones_cl
          SET smartbc_contactos    = $2::jsonb,
              smartbc_contactos_at = CASE WHEN $2::jsonb IS NULL THEN NULL ELSE now() END,
              smartbc_contactos_by = CASE WHEN $2::jsonb IS NULL THEN NULL ELSE $3 END,
              updated_at           = now()
        WHERE id = $1
        RETURNING id, smartbc_contactos, smartbc_contactos_at, smartbc_contactos_by`,
      [cap.id, seleccion ? JSON.stringify(seleccion) : null, by ?? null],
    )
    return NextResponse.json({ success: true, data: rows[0] })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 400 },
    )
  }
}

/**
 * POST — envía la captación al CRM.
 * Body: { id, contactos?, dry_run?, stage?, by?, force_fields? }
 *
 * Si vienen `contactos`, se guardan antes de enviar: el botón hace las dos
 * cosas de una vez, que es como lo usa el equipo (elijo teléfonos → Agregar).
 *
 * `force_fields` es la excepción explícita a "SmartBC solo escribe campos
 * vacíos": solo acepta los de FORCEABLE_TEAM_FIELDS (notes, owner.contact),
 * que siempre llevan texto NUESTRO derivado — nunca algo que la captadora
 * haya escrito a mano en SmartBC. Sirve para limpiar fichas que ya se
 * sincronizaron con texto viejo (p. ej. antes de dejar de mencionar
 * "DealerNet"/"casafari-mio" en notes y owner.contact).
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'JSON inválido' }, { status: 400 })
  }

  const { id, contactos, dry_run: dryRun, stage, by, force_fields: forceFieldsRaw } = body as {
    id?: string; contactos?: unknown; dry_run?: boolean; stage?: string | null; by?: string
    force_fields?: unknown
  }
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ success: false, error: 'Falta id' }, { status: 400 })
  }
  let forceFields: string[]
  try {
    forceFields = parseForceFields(forceFieldsRaw)
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'force_fields inválido' },
      { status: 400 },
    )
  }
  if (!process.env.SMARTBC_API_KEY) {
    return NextResponse.json(
      { success: false, error: 'Falta SMARTBC_API_KEY en el servidor' },
      { status: 503 },
    )
  }

  try {
    let seleccion: Seleccion[] | null = null
    try {
      seleccion = parseSeleccion(contactos)
    } catch (err) {
      return NextResponse.json(
        { success: false, error: err instanceof Error ? err.message : 'Selección inválida' },
        { status: 400 },
      )
    }

    let cap = await cargarCaptacion(id)
    if (!cap) {
      return NextResponse.json(
        { success: false, error: 'Esta propiedad todavía no tiene captación (rol y dueño sin resolver)' },
        { status: 404 },
      )
    }

    // La selección se persiste ANTES de enviar. Si el envío falla, la curación
    // del equipo no se pierde: al reintentar ya está guardada.
    if (seleccion) {
      await pool.query(
        `UPDATE captaciones_cl
            SET smartbc_contactos = $2::jsonb, smartbc_contactos_at = now(),
                smartbc_contactos_by = $3, updated_at = now()
          WHERE id = $1`,
        [cap.id, JSON.stringify(seleccion), by ?? null],
      )
      cap = { ...cap, smartbc_contactos: seleccion }
    }

    const smartbc = new SmartbcClient({
      apiKey: process.env.SMARTBC_API_KEY,
      baseUrl: process.env.SMARTBC_BASE_URL,
      dryRun: dryRun === true,
    })

    const listingsByCap = await loadListings(
      { query: (sql: string, params: unknown[]) => pool.query(sql === LISTINGS_SQL ? LISTINGS_SQL : sql, params) },
      [cap],
    )
    const listings = listingsByCap.get(cap.id) ?? []

    // Mismo catálogo geográfico que usa la sincronización: región y comuna se
    // normalizan contra el de SmartBC, no se manda texto libre.
    let normalizer: ReturnType<typeof buildNormalizer>
    try {
      normalizer = buildNormalizer(await fetchCatalogo(smartbc, {
        comunasDeInteres: [cap.comuna_name ?? cap.comuna_label].filter(Boolean),
      }))
    } catch {
      normalizer = buildNormalizer({ regiones: [], comunas: [], zonasPorComuna: new Map() })
    }

    const plan = planItem(cap, listings, {
      stage: stage === undefined ? 'assigned' : stage,
      normalizer,
      forceFields,
    })

    // Desde el botón, "no ha cambiado nada" no debe ser un no-op silencioso: la
    // persona espera ver el resultado. Se reenvía la ficha completa.
    const item = plan.action === 'unchanged' ? plan.payload : plan.item

    const externalId = externalIdFor(cap.id)
    const res = await smartbc.upsertCaptacion(item, {
      idempotencyKey: `${externalId}-boton-${plan.hash.slice(0, 16)}`,
    })

    if (!dryRun) {
      await recordResult(pool, {
        captacionId: cap.id,
        externalId,
        action: res.data.action,
        payload: plan.payload,
        hash: plan.hash,
        result: { ...res.data, request_id: res.requestId },
        error: null,
      })
      // La marca manual se mantiene en sintonía: la ficha de Propiedades sigue
      // mostrando "ya está en Smart" con la misma señal que antes, ahora
      // respaldada por un envío real.
      if (cap.property_cl_id) {
        await pool.query(
          `UPDATE property_cl SET smart_crm_at = now(), updated_at = now() WHERE id = $1`,
          [cap.property_cl_id],
        )
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        action: res.data.action,
        admin_url: res.data.admin_url,
        request_id: res.requestId,
        changed_fields: res.data.changed_fields ?? [],
        protected_fields: res.data.protected_fields ?? [],
        sections: res.data.sections ?? {},
        warnings: res.data.warnings ?? [],
        contactos_enviados: (item.contacts ?? []).length,
        dry_run: dryRun === true,
      },
    })
  } catch (error) {
    const err = error as { status?: number; code?: string; message?: string; requestId?: string; details?: unknown }
    // El código de SmartBC se propaga tal cual: la UI distingue "arregla el
    // dato" (validation_error) de "vuelve a intentarlo" (rate_limited, 503).
    return NextResponse.json(
      {
        success: false,
        error: err.message ?? 'Error enviando a SmartBC',
        code: err.code ?? null,
        details: err.details ?? null,
        request_id: err.requestId ?? null,
      },
      { status: err.status && err.status >= 400 && err.status < 600 ? err.status : 500 },
    )
  }
}
