// ─────────────────────────────────────────────────────────────────────────────
// Sincronizador de captaciones -mio → CRM SmartBC.
//
// Une las tres piezas: lee de la BD lo que está listo para subir
// (selectPendingCaptaciones), lo traduce al contrato (smartbc-mapper.mjs), lo
// envía en lotes (smartbc-client.mjs) y deja constancia de todo en
// smartbc_sync_cl (migración 0091).
//
// Las tres decisiones que definen el comportamiento:
//
//   1. QUÉ SUBE. Solo captaciones con rol confirmado Y dueño Y teléfono
//      (stage='contact_found', sin revisión pendiente). Una ficha sin a quién
//      llamar no le sirve al equipo comercial: le añade ruido a su cola.
//   2. UNA POR INMUEBLE. Si dos URLs distintas resolvieron al mismo property_cl,
//      solo sube la más completa. Las otras no se pierden: sus anuncios viajan
//      dentro de listings[] de esa misma ficha, que es justo para lo que existe
//      la pestaña "Corredoras" de SmartBC.
//   3. SOLO LO QUE CAMBIA. El hash del último payload aceptado decide: si es el
//      mismo, no se envía NADA (ni siquiera para que la API conteste
//      "unchanged"); si cambió, va un PATCH con los campos movidos, no la ficha
//      entera con sus 60 fotos.
//
// `client` (pg) y `smartbc` son inyectables para poder testear la orquestación
// entera sin BD ni red — ver smartbc-sync-cl.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto'
import {
  buildCaptacionPayload,
  diffPayload,
  externalIdFor,
  isEmptyPatch,
  payloadHash,
} from './smartbc-mapper.mjs'

export const BATCH_SIZE = 100   // tope de SmartBC por llamada a /batch

/**
 * Captaciones listas para subir, y que además han cambiado desde el último
 * envío aceptado (o que nunca se enviaron, o cuyo último envío falló).
 *
 * El `DISTINCT ON (COALESCE(property_cl_id, id))` implementa la regla 2: una
 * captación por inmueble físico. El criterio de "la más completa" es el mismo
 * que ya usa el backfill de la migración 0083, para no tener dos definiciones
 * distintas de "captación principal" en el repo.
 */
export const PENDING_SQL = `
WITH elegibles AS (
  SELECT cap.*
    FROM captaciones_cl cap
   WHERE cap.stage = 'contact_found'
     AND cap.needs_review = false
     AND cap.match_confidence IN ('confirmed','high')
     AND cap.owner_name IS NOT NULL
     AND cap.phones IS NOT NULL
     AND jsonb_array_length(cap.phones) > 0
), principal AS (
  SELECT DISTINCT ON (COALESCE(cap.property_cl_id, cap.id)) cap.*
    FROM elegibles cap
   ORDER BY COALESCE(cap.property_cl_id, cap.id),
            (cap.owner_name IS NOT NULL) DESC,
            (cap.phones IS NOT NULL) DESC,
            cap.updated_at DESC
)
SELECT cap.*,
       com.name    AS comuna_name,
       com.region  AS comuna_region,
       p.localidad AS property_localidad,
       s.payload_hash,
       s.last_payload,
       s.external_id AS synced_external_id,
       s.synced_at
  FROM principal cap
  LEFT JOIN smartbc_sync_cl s ON s.captacion_id = cap.id
  LEFT JOIN property_cl p     ON p.id = cap.property_cl_id
  LEFT JOIN LATERAL (
    SELECT c.name, c.region
      FROM chile_comunas c
     WHERE (cap.sii_comuna_code IS NOT NULL AND c.sii_comuna_code = cap.sii_comuna_code)
        OR (cap.sii_comuna_code IS NULL AND c.name = cap.comuna_label)
     LIMIT 1
  ) com ON true
 WHERE s.captacion_id IS NULL
    OR s.synced_at IS NULL
    OR s.last_action = 'failed'
    OR cap.updated_at > s.synced_at
 ORDER BY cap.updated_at
 LIMIT $1
`

/** Anuncios del grupo: los del mismo property_cl, más el que originó la captación. */
export const LISTINGS_SQL = `
SELECT l.id, l.portal, l.source_type, l.external_id, l.source_url, l.operation,
       l.advertiser_name, l.advertiser_id, l.price, l.price_uf, l.currency,
       l.bedrooms, l.bathrooms, l.square_meters, l.property_type, l.localidad,
       l.address, l.latitude, l.longitude, l.description, l.features, l.photos,
       l.stored_photos, l.seller_reference, l.status, l.property_cl_id,
       l.comuna_raw, l.detail_parsed_at, l.corredora_id,
       com.name             AS comuna_name,
       com.region           AS comuna_region,
       cor.name_normalized  AS corredora_name
  FROM listings_cl l
  LEFT JOIN chile_comunas com ON com.id = l.comuna_id
  LEFT JOIN corredoras_cl cor ON cor.id = l.corredora_id
 WHERE l.property_cl_id = ANY($1::uuid[])
    OR l.id = ANY($2::uuid[])
 ORDER BY l.first_seen_at
`

export async function selectPendingCaptaciones(client, { limit = BATCH_SIZE } = {}) {
  const { rows } = await client.query(PENDING_SQL, [limit])
  return rows
}

/** Agrupa los anuncios de todas las captaciones del lote en una sola consulta. */
export async function loadListings(client, captaciones) {
  const propertyIds = [...new Set(captaciones.map((c) => c.property_cl_id).filter(Boolean))]
  const listingIds = [...new Set(captaciones.map((c) => c.listing_cl_id).filter(Boolean))]
  if (!propertyIds.length && !listingIds.length) return new Map()

  const { rows } = await client.query(LISTINGS_SQL, [propertyIds, listingIds])
  const byProperty = new Map()
  const byId = new Map()
  for (const l of rows) {
    byId.set(l.id, l)
    if (l.property_cl_id) {
      if (!byProperty.has(l.property_cl_id)) byProperty.set(l.property_cl_id, [])
      byProperty.get(l.property_cl_id).push(l)
    }
  }

  const out = new Map()
  for (const cap of captaciones) {
    const grupo = cap.property_cl_id ? [...(byProperty.get(cap.property_cl_id) ?? [])] : []
    const propio = cap.listing_cl_id ? byId.get(cap.listing_cl_id) : null
    if (propio && !grupo.some((l) => l.id === propio.id)) grupo.push(propio)
    out.set(cap.id, grupo)
  }
  return out
}

/** Fila de la consulta → bundle que entiende el mapper. */
export function toBundle(cap, listings) {
  return {
    captacion: cap,
    comuna: { name: cap.comuna_name, region: cap.comuna_region },
    property: { localidad: cap.property_localidad },
    listings,
  }
}

/**
 * Decide qué hacer con una captación: nada, alta completa o PATCH diferencial.
 * Devuelve `{ action, item, payload, hash }` donde `item` es lo que va al lote.
 */
export function planItem(cap, listings, options) {
  const payload = buildCaptacionPayload(toBundle(cap, listings), options)
  const hash = payloadHash(payload)

  // Ya está en SmartBC y el payload es byte a byte el mismo: no se envía nada.
  // Es el caso mayoritario en una sincronización periódica y el que mantiene el
  // consumo de cuota (120/min) proporcional a lo que cambia, no al inventario.
  if (cap.payload_hash === hash && cap.synced_at) {
    return { action: 'unchanged', item: null, payload, hash }
  }

  if (!cap.synced_at || !cap.last_payload) {
    return { action: 'create', item: payload, payload, hash }
  }

  const patch = diffPayload(cap.last_payload, payload)
  if (isEmptyPatch(patch)) return { action: 'unchanged', item: null, payload, hash }
  return { action: 'update', item: patch, payload, hash }
}

/**
 * Idempotency-Key derivada del CONTENIDO del lote.
 *
 * Atarla al contenido es lo que hace segura la clave: reintentar el mismo lote
 * tras un timeout devuelve la respuesta original (`X-Idempotent-Replay: true`)
 * en vez de duplicar, y es imposible caer en el `409 conflict` de "misma clave,
 * cuerpo distinto" porque un cuerpo distinto produce otra clave.
 */
export function idempotencyKeyFor(items, prefix = 'mio-sync') {
  const digest = createHash('sha256')
    .update(items.map((i) => JSON.stringify(i)).join('\n'))
    .digest('hex')
    .slice(0, 24)
  return `${prefix}-${digest}`
}

/**
 * Índices del lote que la validación rechazó, sacados de `details`.
 *
 * Comprobado en vivo contra la API (dry-run): un elemento que incumple el
 * SCHEMA (un enum inventado, un tipo equivocado) NO se reporta por elemento —
 * tumba el lote entero con un 400, porque el cuerpo se valida antes de procesar
 * nada. Lo que sí hace la respuesta es nombrar cada campo malo con su índice
 * (`items.1.property_type`), y eso es lo que permite recuperarse.
 *
 * Sin esto, una sola captación con un dato raro bloquearía a las otras 99 en
 * cada corrida, para siempre. (Los errores de NEGOCIO — un email de agente que
 * no existe, por ejemplo — sí vienen por elemento, en `warnings`, y no rompen
 * el lote.)
 */
export function badIndicesFrom(error) {
  const out = new Map()
  for (const d of error?.details ?? []) {
    const m = /^items\.(\d+)(?:\.(.*))?$/.exec(d?.field ?? '')
    if (!m) continue
    const idx = Number(m[1])
    if (!out.has(idx)) out.set(idx, [])
    out.get(idx).push(`${m[2] ?? 'item'}: ${d.message}`)
  }
  return out
}

/**
 * Envía un lote apartando los elementos que la validación rechace, hasta que
 * pase o no quede nada. Devuelve `{ response, enviados, rechazados }`, donde
 * `enviados` son las entradas que llegaron a procesarse (alineadas con los
 * índices de `response.data`) y `rechazados` mapea entrada → error.
 */
export async function sendBatchApartandoInvalidos(smartbc, entradas, { dryRun } = {}) {
  let pendientes = entradas.map((e, origIndex) => ({ ...e, origIndex }))
  const rechazados = new Map()

  // Tope de rondas: cada una aparta al menos un elemento, así que 5 sobran para
  // un lote de 100 con datos sucios; el tope solo evita un bucle infinito si la
  // API devolviera un 400 sin índices utilizables.
  for (let ronda = 0; ronda < 5 && pendientes.length; ronda++) {
    const items = pendientes.map((p) => p.plan.item)
    try {
      const response = await smartbc.batch(items, { idempotencyKey: idempotencyKeyFor(items), dryRun })
      return { response, enviados: pendientes, rechazados }
    } catch (err) {
      const malos = err?.status === 400 && err?.code === 'validation_error'
        ? badIndicesFrom(err)
        : new Map()
      if (!malos.size) throw err   // 401, 413, red agotada… no es cosa de un elemento

      for (const [idx, campos] of malos) {
        const p = pendientes[idx]
        if (!p) continue
        rechazados.set(p.origIndex, {
          code: 'validation_error',
          message: campos.join(' · '),
          status: 400,
          requestId: err.requestId,
        })
      }
      pendientes = pendientes.filter((_, i) => !malos.has(i))
    }
  }
  return { response: null, enviados: [], rechazados }
}

/** Persiste el resultado de un envío (éxito o error) en smartbc_sync_cl. */
export async function recordResult(client, { captacionId, externalId, action, payload, hash, result, error }) {
  if (error) {
    await client.query(
      `INSERT INTO smartbc_sync_cl (captacion_id, external_id, last_action, request_id,
                                    last_error_code, last_error_http, last_error, last_error_at, attempts)
            VALUES ($1, $2, 'failed', $3, $4, $5, $6, now(), 1)
       ON CONFLICT (captacion_id) DO UPDATE SET
            last_action     = 'failed',
            request_id      = COALESCE(EXCLUDED.request_id, smartbc_sync_cl.request_id),
            last_error_code = EXCLUDED.last_error_code,
            last_error_http = EXCLUDED.last_error_http,
            last_error      = EXCLUDED.last_error,
            last_error_at   = now(),
            attempts        = smartbc_sync_cl.attempts + 1,
            updated_at      = now()`,
      [captacionId, externalId, error.requestId ?? null, error.code ?? null,
       error.status ?? null, String(error.message ?? error).slice(0, 2000)],
    )
    return
  }

  // 'unchanged' no toca payload_hash/last_payload (ya son los correctos) pero sí
  // deja constancia de que la captación se revisó en esta corrida.
  await client.query(
    `INSERT INTO smartbc_sync_cl (captacion_id, external_id, smartbc_id, admin_url, last_action,
                                  payload_hash, last_payload, changed_fields, protected_fields,
                                  warnings, request_id, attempts, synced_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, $11, 1, now())
     ON CONFLICT (captacion_id) DO UPDATE SET
          external_id      = EXCLUDED.external_id,
          smartbc_id       = COALESCE(EXCLUDED.smartbc_id, smartbc_sync_cl.smartbc_id),
          admin_url        = COALESCE(EXCLUDED.admin_url, smartbc_sync_cl.admin_url),
          last_action      = EXCLUDED.last_action,
          payload_hash     = EXCLUDED.payload_hash,
          last_payload     = EXCLUDED.last_payload,
          changed_fields   = EXCLUDED.changed_fields,
          protected_fields = EXCLUDED.protected_fields,
          warnings         = EXCLUDED.warnings,
          request_id       = EXCLUDED.request_id,
          attempts         = smartbc_sync_cl.attempts + 1,
          synced_at        = now(),
          updated_at       = now()`,
    [
      captacionId, externalId,
      result?.id ?? null,
      result?.admin_url ?? null,
      action,
      hash,
      JSON.stringify(payload),
      result?.changed_fields ?? [],
      result?.protected_fields ?? [],
      JSON.stringify(result?.warnings ?? []),
      result?.request_id ?? null,
    ],
  )
}

/**
 * Una pasada completa de sincronización.
 *
 * @param {object} deps
 * @param {object} deps.client   cliente pg (o compatible con .query)
 * @param {object} deps.smartbc  SmartbcClient
 * @param {object} [opts]
 * @param {number} [opts.limit]      máximo de captaciones a procesar
 * @param {boolean} [opts.dryRun]    valida contra SmartBC sin escribir
 * @param {string|null} [opts.stage] etapa inicial al crear
 * @param {boolean} [opts.includeNotes]
 * @param {Function} [opts.log]
 */
export async function syncOnce({ client, smartbc }, opts = {}) {
  const {
    limit = BATCH_SIZE,
    dryRun = false,
    stage = 'assigned',
    includeNotes = true,
    log = () => {},
  } = opts

  const captaciones = await selectPendingCaptaciones(client, { limit })
  const summary = { total: captaciones.length, created: 0, updated: 0, unchanged: 0, failed: 0, requestIds: [] }
  if (!captaciones.length) return summary

  const listingsByCap = await loadListings(client, captaciones)

  const planned = []
  for (const cap of captaciones) {
    const plan = planItem(cap, listingsByCap.get(cap.id) ?? [], { stage, includeNotes })
    if (plan.action === 'unchanged') {
      summary.unchanged++
      // Se registra igual: deja el rastro de que la captación se revisó hoy y
      // no hacía falta tocarla, que es distinto de "nunca se miró".
      await recordResult(client, {
        captacionId: cap.id,
        externalId: externalIdFor(cap.id),
        action: 'unchanged',
        payload: plan.payload,
        hash: plan.hash,
        result: { request_id: null },
      })
      continue
    }
    planned.push({ cap, plan })
  }
  if (!planned.length) return summary

  // Lotes de 100: es el tope de la API y mantiene el cuerpo lejos de los 2 MB.
  for (let i = 0; i < planned.length; i += BATCH_SIZE) {
    const slice = planned.slice(i, i + BATCH_SIZE)
    let response = null
    let enviados = []
    let rechazados = new Map()
    let batchError = null

    try {
      ({ response, enviados, rechazados } = await sendBatchApartandoInvalidos(smartbc, slice, { dryRun }))
    } catch (err) {
      batchError = err
    }

    if (batchError) {
      // El lote entero no llegó a procesarse (401, 413, red agotada…). Cada
      // captación queda marcada como fallida con el mismo motivo: al reintentar,
      // la consulta de pendientes las vuelve a coger.
      log(`✗ lote ${i / BATCH_SIZE + 1}: ${batchError.message}`)
      for (const { cap, plan } of slice) {
        summary.failed++
        await recordResult(client, {
          captacionId: cap.id,
          externalId: externalIdFor(cap.id),
          action: plan.action,
          payload: plan.payload,
          hash: plan.hash,
          error: batchError,
        })
      }
      continue
    }

    if (response?.requestId) summary.requestIds.push(response.requestId)

    // Los apartados por la validación: se registran con el campo exacto que
    // señaló la API, para que se puedan arreglar en el origen.
    for (const [origIndex, err] of rechazados) {
      const { cap, plan } = slice[origIndex]
      const externalId = externalIdFor(cap.id)
      summary.failed++
      log(`✗ ${externalId}: ${err.code} — ${err.message}`)
      await recordResult(client, {
        captacionId: cap.id, externalId, action: plan.action,
        payload: plan.payload, hash: plan.hash, error: err,
      })
    }

    const results = Array.isArray(response?.data) ? response.data : []
    const byIndex = new Map(results.map((r) => [r.index, r]))

    for (let j = 0; j < enviados.length; j++) {
      const { cap, plan } = enviados[j]
      const r = byIndex.get(j)
      const externalId = externalIdFor(cap.id)

      if (!r || r.ok === false) {
        summary.failed++
        const err = {
          code: r?.error?.code ?? 'missing_result',
          message: r?.error?.message ?? 'SmartBC no devolvió resultado para este elemento',
          status: null,
          requestId: response.requestId,
        }
        log(`✗ ${externalId}: ${err.code} — ${err.message}`)
        await recordResult(client, {
          captacionId: cap.id, externalId, action: plan.action,
          payload: plan.payload, hash: plan.hash, error: err,
        })
        continue
      }

      const action = r.action ?? plan.action
      if (action === 'created') summary.created++
      else if (action === 'updated') summary.updated++
      else summary.unchanged++

      if (r.warnings?.length) log(`⚠ ${externalId}: ${r.warnings.join(' · ')}`)

      // En dry-run NO se guarda el hash: nada se escribió en SmartBC, así que
      // dar la captación por sincronizada dejaría la ficha real sin subir.
      if (dryRun) continue

      await recordResult(client, {
        captacionId: cap.id, externalId, action,
        payload: plan.payload, hash: plan.hash,
        result: { ...r, request_id: r.request_id ?? response.requestId },
      })
    }
  }

  return summary
}
