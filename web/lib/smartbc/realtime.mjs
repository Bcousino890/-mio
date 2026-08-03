// ─────────────────────────────────────────────────────────────────────────────
// Propagación en vivo -mio → SmartBC.
//
// El sincronizador periódico (sync.mjs) contesta "¿qué ha cambiado hoy?". Esto
// contesta otra pregunta: "acaba de cambiar algo, llévalo ahora". Entre quitar
// un contacto que no era y que el CRM lo refleje ya no cabe una noche.
//
// El disparo viene de la base de datos (migración 0098): una captación se
// toca desde la ficha, desde captar-url, desde el worker de anuncios y desde
// psql a mano, y poner el aviso en cada camino es garantizar que el próximo se
// olvide. Aquí solo se drena lo que la bandeja ya tiene.
//
// Reusa el mapeo y el diff de sync.mjs sin copiarlos: el contrato con SmartBC
// tiene UNA definición en el repo. Lo único propio de este módulo es el ritmo:
// uno a uno, en cuanto llega, en vez de por lotes cuando toque — y el retiro
// de contactos que ya no van, que el envío por lotes no necesita resolver caso
// a caso porque siempre reenvía la ficha completa de una sentada.
// ─────────────────────────────────────────────────────────────────────────────

import { EXTERNAL_ID_PREFIX, externalIdFor } from './mapper.mjs'
import { loadListings, planItem, recordResult } from './sync.mjs'
import { PASSTHROUGH } from './catalogo.mjs'

/** Canal de PostgreSQL por el que la 0098 avisa. */
export const CANAL_DIRTY = 'smartbc_dirty_cl'

/** Cuántas se drenan por pasada. Techo bajo: esto compite con el CRM por la cuota. */
export const LOTE = 20

/**
 * Espera antes de reintentar, por número de intentos fallidos: 30s, 2min, 8min,
 * 32min, 2h (tope). Exponencial y con techo — una captación con un dato que
 * SmartBC rechaza no puede quedarse dando vueltas cada 30 segundos para siempre
 * consumiendo la cuota de las que sí tienen algo que decir.
 */
export function esperaReintento(attempts) {
  const segundos = Math.min(30 * 4 ** Math.max(0, attempts - 1), 7200)
  return `${segundos} seconds`
}

/**
 * Una captación con todo lo que el mapper necesita. Mismas tablas y los
 * mismos JOINs que `PENDING_SQL` de sync.mjs (comuna, pin manual, catastro
 * SII, verificación de WhatsApp), pero filtrando por `id` en vez de por la
 * cola de pendientes: si divergieran, el payload en vivo y el nocturno serían
 * distintos para la misma ficha y cada uno pisaría al otro en cada pasada.
 */
export const CAPTACION_SQL = `
SELECT cap.*,
       com.name    AS comuna_name,
       com.region  AS comuna_region,
       p.localidad AS property_localidad,
       p.manual_latitude::float8  AS property_manual_latitude,
       p.manual_longitude::float8 AS property_manual_longitude,
       sr.superficie_terreno_m2   AS sii_superficie_terreno_m2,
       wa.map AS whatsapp_verificaciones,
       s.payload_hash,
       s.last_payload,
       s.synced_at
  FROM captaciones_cl cap
  LEFT JOIN smartbc_sync_cl s ON s.captacion_id = cap.id
  LEFT JOIN property_cl p     ON p.id = cap.property_cl_id
  LEFT JOIN sii_roles_cl sr   ON sr.sii_comuna_code = cap.sii_comuna_code AND sr.rol = cap.sii_rol
  LEFT JOIN LATERAL (
    SELECT jsonb_object_agg(
             v.phone_e164,
             jsonb_build_object(
               'tiene_whatsapp', v.tiene_whatsapp,
               'tiene_foto', v.tiene_foto,
               'verificado_at', v.verificado_at
             )
           ) AS map
      FROM whatsapp_verificaciones_cl v
     WHERE v.estado = 'ok'
       AND v.phone_e164 IN (
         SELECT '+' || regexp_replace(tel->>'numero', '\\D', '', 'g')
           FROM jsonb_array_elements(COALESCE(cap.phones, '[]'::jsonb)) tel
       )
  ) wa ON true
  LEFT JOIN LATERAL (
    SELECT c.name, c.region
      FROM chile_comunas c
     WHERE (cap.sii_comuna_code IS NOT NULL AND c.sii_comuna_code = cap.sii_comuna_code)
        OR (cap.sii_comuna_code IS NULL AND c.name = cap.comuna_label)
     LIMIT 1
  ) com ON true
 WHERE cap.id = $1
`

/**
 * Toma hasta `limit` pendientes cuyo turno ha llegado.
 *
 * `FOR UPDATE SKIP LOCKED` para que dos workers (o un despliegue solapado) no
 * se peleen por la misma fila: el segundo se lleva otras en vez de bloquearse.
 */
export const CLAIM_SQL = `
SELECT captacion_id, attempts
  FROM smartbc_outbox_cl
 WHERE next_try_at <= now()
 ORDER BY dirty_at
 LIMIT $1
 FOR UPDATE SKIP LOCKED
`

/**
 * ¿Sigue esta captación en condiciones de estar en el CRM?
 *
 * Es el mismo filtro del sincronizador (§3 de la doc): dueño, teléfonos, rol
 * sin revisión pendiente. Una captación que aún no lo cumple se saca de la
 * bandeja sin enviar nada — no es un error, es que todavía no le toca.
 */
export function elegible(cap) {
  return Boolean(cap)
    && cap.stage === 'contact_found'
    && cap.needs_review === false
    && ['confirmed', 'high'].includes(cap.match_confidence)
    && cap.owner_name != null
    && Array.isArray(cap.phones ?? null) && cap.phones.length > 0
}

/**
 * Quita de SmartBC los contactos NUESTROS que ya no van en la ficha.
 *
 * Hace falta porque `contacts[]` es un upsert, no un `sync`: a diferencia de
 * `photos`, que lleva `mode` y borra las que dejas de mandar, un contacto que
 * quitamos de la selección se queda en su ficha para siempre. Eso convertía la
 * curación en papel mojado — quitabas la cuñada del cónyuge de la lista y allí
 * seguía, con su teléfono, para quien fuera a llamar. El envío por lotes no
 * necesita resolver esto: siempre reenvía la ficha completa, así que basta con
 * lo que SmartBC ya sabe hacer con un `contacts[]` más corto (nada, hoy) — es
 * la propagación en vivo, más frecuente y más quirúrgica, la que lo necesita.
 *
 * REGLA DURA: solo se borra lo que empieza por nuestro prefijo. Un contacto que
 * su equipo creó a mano en el panel no lo tocamos jamás, aunque no esté en
 * nuestro payload — no está porque nunca fue nuestro, no porque sobre.
 */
export async function reconcileContacts(smartbc, externalId, contactsEnviados, { dryRun = false } = {}) {
  const mios = new Set(
    (contactsEnviados ?? []).map((c) => c?.external_id).filter(Boolean),
  )

  let remotos
  try {
    const res = await smartbc.getContactos(externalId)
    remotos = Array.isArray(res?.data) ? res.data : []
  } catch {
    // Si no se pueden listar, no se borra nada. Un fallo leyendo no puede
    // convertirse en un borrado a ciegas.
    return { borrados: 0, ajenos: 0 }
  }

  let borrados = 0
  let ajenos = 0
  for (const r of remotos) {
    const externo = r?.external_id ?? null
    // Sin external_id, o con uno que no es nuestro: es del equipo de SmartBC.
    if (!externo || !String(externo).startsWith(EXTERNAL_ID_PREFIX)) { ajenos++; continue }
    if (mios.has(externo)) continue
    const id = r?.id ?? r?.contact_id ?? null
    if (id == null || typeof smartbc.deleteContacto !== 'function') continue
    try {
      await smartbc.deleteContacto(externalId, id, { dryRun })
      borrados++
    } catch {
      // Un borrado que falla no tumba el envío: el resto de la ficha ya subió
      // y la próxima pasada vuelve a intentarlo.
    }
  }
  return { borrados, ajenos }
}

/**
 * Envía UNA captación. Devuelve qué pasó, sin lanzar: quien llama decide si eso
 * es "sácala de la bandeja" o "reintenta más tarde".
 */
export async function pushCaptacion(client, smartbc, captacionId, {
  stage = null,
  includeNotes = true,
  normalizer = PASSTHROUGH,
  baseUrl = null,
  dryRun = false,
} = {}) {
  const { rows } = await client.query(CAPTACION_SQL, [captacionId])
  const cap = rows[0] ?? null

  // Ya no existe, o todavía no está lista: fuera de la bandeja, sin enviar.
  if (!cap) return { accion: 'descartada', motivo: 'la captación ya no existe' }
  if (!elegible(cap)) return { accion: 'descartada', motivo: 'aún no cumple la condición de envío' }

  const listingsByCap = await loadListings(client, [cap])
  const listings = listingsByCap.get(cap.id) ?? []

  // `stage` solo tiene efecto al crear y después es campo del equipo, pero en
  // vivo NO se opina ni al crear: una ficha que nace de un cambio de precio no
  // tiene por qué mover la etapa que su equipo esté trabajando.
  const plan = planItem(cap, listings, { stage, includeNotes, normalizer, baseUrl })
  const externalId = externalIdFor(cap.id)

  if (plan.action === 'unchanged') {
    // Cambió algo que no viaja al CRM (un campo interno, un timestamp). Es el
    // caso mayoritario de un disparo por trigger, y no gasta ni una llamada.
    return { accion: 'sin-cambios', externalId }
  }

  const res = plan.action === 'create'
    ? await smartbc.upsertCaptacion(plan.item, {
        idempotencyKey: `${externalId}-vivo-${plan.hash.slice(0, 16)}`,
        dryRun,
      })
    : await smartbc.patchCaptacion(externalId, plan.item, {
        idempotencyKey: `${externalId}-vivo-${plan.hash.slice(0, 16)}`,
        dryRun,
      })

  // El retiro va DESPUÉS del alta y solo si fue bien: si el envío falló, la
  // ficha del CRM sigue teniendo los contactos viejos y borrarlos la dejaría
  // sin ninguno.
  const contactos = await reconcileContacts(smartbc, externalId, plan.payload.contacts, { dryRun })

  if (!dryRun) {
    await recordResult(client, {
      captacionId: cap.id,
      externalId,
      action: res.data.action,
      payload: plan.payload,
      hash: plan.hash,
      result: { ...res.data, request_id: res.requestId, contactos_retirados: contactos.borrados },
      error: null,
    })
  }

  return {
    accion: res.data.action,
    externalId,
    requestId: res.requestId,
    contactosRetirados: contactos.borrados,
  }
}

/**
 * Drena la bandeja: coge lo que toca, lo envía y decide qué hacer con cada una.
 *
 * Todo dentro de UNA transacción por pasada, con las filas bloqueadas con SKIP
 * LOCKED: dos workers a la vez se reparten el trabajo en vez de duplicarlo.
 */
export async function drainOutbox({ client, smartbc }, opts = {}) {
  const { limit = LOTE, log = () => {}, ...pushOpts } = opts
  const resumen = { tomadas: 0, enviadas: 0, sinCambios: 0, descartadas: 0, fallidas: 0, contactosRetirados: 0 }

  await client.query('BEGIN')
  try {
    const { rows: pendientes } = await client.query(CLAIM_SQL, [limit])
    resumen.tomadas = pendientes.length

    for (const fila of pendientes) {
      const id = fila.captacion_id
      try {
        const r = await pushCaptacion(client, smartbc, id, pushOpts)
        if (r.accion === 'descartada') resumen.descartadas++
        else if (r.accion === 'sin-cambios') resumen.sinCambios++
        else {
          resumen.enviadas++
          resumen.contactosRetirados += r.contactosRetirados ?? 0
          log(`✓ ${r.externalId} ${r.accion}${r.contactosRetirados ? ` · ${r.contactosRetirados} contacto(s) retirado(s)` : ''}`)
        }
        await client.query('DELETE FROM smartbc_outbox_cl WHERE captacion_id = $1', [id])
      } catch (err) {
        resumen.fallidas++
        const intentos = (fila.attempts ?? 0) + 1
        // La fila se queda, con su turno aplazado. Se pierde el envío de ahora,
        // no el cambio: sigue pendiente hasta que entre.
        await client.query(
          `UPDATE smartbc_outbox_cl
              SET attempts = $2, next_try_at = now() + $3::interval, last_error = $4
            WHERE captacion_id = $1`,
          [id, intentos, esperaReintento(intentos), String(err?.message ?? err).slice(0, 500)],
        )
        log(`✗ ${id} (intento ${intentos}): ${err?.message ?? err}`)
      }
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
  return resumen
}
