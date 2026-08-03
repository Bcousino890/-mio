// Tests de la propagación en vivo (realtime.mjs).
//
// Lo que cubren, por orden de "cuánto duele si se rompe":
//   · NUNCA se borra un contacto que no sea nuestro. Es lo único de toda la
//     integración que destruye trabajo ajeno si se equivoca.
//   · Un envío fallido no borra nada (dejaría la ficha sin contactos).
//   · Un fallo aplaza la fila, no la pierde.
//   · Lo que no cambia no gasta una llamada.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  drainOutbox,
  elegible,
  esperaReintento,
  pushCaptacion,
  reconcileContacts,
} from './realtime.mjs'
import { PASSTHROUGH } from './catalogo.mjs'
import { buildCaptacionPayload, externalIdFor, payloadHash } from './mapper.mjs'

const CAP_ID = '11111111-1111-1111-1111-111111111111'
const EXT = externalIdFor(CAP_ID)

const CAP = {
  id: CAP_ID,
  property_cl_id: 'pppppppp-0000-0000-0000-000000000001',
  listing_cl_id: null,
  source_url: 'https://www.portalinmobiliario.com/MLC-999',
  title: 'Casa en Las Condes',
  operation: 'sale',
  property_type: 'casa',
  price_raw: 450000000,
  currency: 'CLP',
  comuna_label: 'Las Condes',
  sii_rol: '795-198',
  owner_name: 'María Pérez',
  owner_rut: '12345678-9',
  phones: [{ numero: '+56912345678', categoria: 'probable' }],
  emails: [],
  relacionados: [],
  photos: [],
  selected_photo_urls: [],
  raw_extracted: {},
  stage: 'contact_found',
  needs_review: false,
  match_confidence: 'confirmed',
  comuna_name: 'Las Condes',
  comuna_region: 'Región Metropolitana de Santiago',
  property_localidad: null,
  payload_hash: null,
  last_payload: null,
  synced_at: null,
}

/** pg simulado: la captación pedida, sin listings, y graba lo que se escribe. */
function makeDb({ captacion = CAP, outbox = [{ captacion_id: CAP_ID, attempts: 0 }] } = {}) {
  const escrituras = []
  return {
    escrituras,
    async query(sql, params = []) {
      // Ojo con el orden: el DELETE de la bandeja también dice "FROM
      // smartbc_outbox_cl", así que la lectura se reconoce por el SELECT.
      if (sql.includes('SELECT captacion_id, attempts')) return { rows: outbox }
      if (sql.includes('FROM captaciones_cl cap')) return { rows: captacion ? [captacion] : [] }
      if (sql.includes('FROM listings_cl')) return { rows: [] }
      escrituras.push({ sql: sql.trim().split('\n')[0], params })
      return { rows: [] }
    },
  }
}

function makeSmartbc({ contactosRemotos = [], falla = null } = {}) {
  const llamadas = []
  return {
    llamadas,
    async upsertCaptacion(item, opts) {
      llamadas.push({ tipo: 'upsert', item, opts })
      if (falla) throw falla
      return { data: { action: 'created' }, requestId: 'req-1' }
    },
    async patchCaptacion(externalId, patch, opts) {
      llamadas.push({ tipo: 'patch', externalId, patch, opts })
      if (falla) throw falla
      return { data: { action: 'updated' }, requestId: 'req-2' }
    },
    async getContactos(externalId) {
      llamadas.push({ tipo: 'getContactos', externalId })
      return { data: contactosRemotos }
    },
    async deleteContacto(externalId, contactId) {
      llamadas.push({ tipo: 'delete', externalId, contactId })
      return { data: { ok: true } }
    },
  }
}

// ─── Borrado de contactos ────────────────────────────────────────────────────

test('un contacto que su equipo creó a mano NO se borra jamás', async () => {
  // El caso que importa: quien decide qué contactos van somos nosotros, pero la
  // ficha del CRM es suya. Un contacto sin nuestro prefijo —o sin external_id
  // ninguno— lo puso una persona en su panel. Que no esté en nuestro payload no
  // significa que sobre: significa que nunca fue nuestro.
  const smartbc = makeSmartbc({
    contactosRemotos: [
      { id: 1, external_id: `${EXT}-owner` },        // nuestro, y sigue yendo
      { id: 2, external_id: `${EXT}-rel-9876543-2` }, // nuestro, ya no va
      { id: 3, external_id: 'smartbc-manual-77' },    // suyo
      { id: 4, external_id: null },                   // suyo, sin id externo
    ],
  })
  const r = await reconcileContacts(smartbc, EXT, [{ external_id: `${EXT}-owner` }])

  const borrados = smartbc.llamadas.filter((l) => l.tipo === 'delete').map((l) => l.contactId)
  assert.deepEqual(borrados, [2], 'solo se borra el nuestro que dejó de ir')
  assert.equal(r.borrados, 1)
  assert.equal(r.ajenos, 2)
})

test('si no se pueden listar los contactos, no se borra nada a ciegas', async () => {
  const smartbc = makeSmartbc()
  smartbc.getContactos = async () => { throw new Error('503') }
  const r = await reconcileContacts(smartbc, EXT, [])
  assert.equal(r.borrados, 0)
  assert.equal(smartbc.llamadas.filter((l) => l.tipo === 'delete').length, 0)
})

test('un borrado que falla no tumba el resto', async () => {
  const smartbc = makeSmartbc({
    contactosRemotos: [{ id: 1, external_id: `${EXT}-a` }, { id: 2, external_id: `${EXT}-b` }],
  })
  let primera = true
  const original = smartbc.deleteContacto
  smartbc.deleteContacto = async (...args) => {
    if (primera) { primera = false; throw new Error('409') }
    return original.call(smartbc, ...args)
  }
  const r = await reconcileContacts(smartbc, EXT, [])
  assert.equal(r.borrados, 1, 'el segundo se borra aunque el primero falle')
})

test('si el envío falla, no se borra ningún contacto', async () => {
  // Borrar después de un alta fallida dejaría la ficha del CRM sin contactos:
  // los nuevos no entraron y los viejos se fueron.
  const db = makeDb()
  const smartbc = makeSmartbc({
    contactosRemotos: [{ id: 9, external_id: `${EXT}-viejo` }],
    falla: new Error('502'),
  })
  await assert.rejects(() => pushCaptacion(db, smartbc, CAP_ID, { normalizer: PASSTHROUGH }))
  assert.equal(smartbc.llamadas.filter((l) => l.tipo === 'delete').length, 0)
})

// ─── Elegibilidad ────────────────────────────────────────────────────────────

test('solo sube lo que cumple la condición de envío', () => {
  assert.equal(elegible(CAP), true)
  assert.equal(elegible({ ...CAP, needs_review: true }), false)
  assert.equal(elegible({ ...CAP, owner_name: null }), false)
  assert.equal(elegible({ ...CAP, phones: [] }), false)
  assert.equal(elegible({ ...CAP, match_confidence: 'low' }), false)
  assert.equal(elegible(null), false)
})

test('una captación que ya no existe se descarta sin enviar nada', async () => {
  const db = makeDb({ captacion: null })
  const smartbc = makeSmartbc()
  const r = await pushCaptacion(db, smartbc, CAP_ID, { normalizer: PASSTHROUGH })
  assert.equal(r.accion, 'descartada')
  assert.equal(smartbc.llamadas.length, 0)
})

// ─── Drenaje ─────────────────────────────────────────────────────────────────

test('lo que cambió por dentro pero no viaja al CRM no gasta una llamada', async () => {
  // Es el caso MAYORITARIO de un disparo por trigger: se toca un campo interno
  // y el payload sale idéntico. Si esto gastara cuota, la propagación en vivo
  // sería insostenible con 120 req/min.
  const payload = buildCaptacionPayload({
    captacion: CAP,
    comuna: { name: CAP.comuna_name, region: CAP.comuna_region },
    property: { localidad: null },
    listings: [],
  }, { normalizer: PASSTHROUGH })

  const db = makeDb({
    captacion: { ...CAP, payload_hash: payloadHash(payload), last_payload: payload, synced_at: new Date() },
  })
  const smartbc = makeSmartbc()
  const r = await drainOutbox({ client: db, smartbc }, { normalizer: PASSTHROUGH })

  assert.equal(r.sinCambios, 1)
  assert.equal(smartbc.llamadas.length, 0)
  assert.ok(
    db.escrituras.some((e) => e.sql.startsWith('DELETE FROM smartbc_outbox_cl')),
    'y sale de la bandeja igual: ya está al día',
  )
})

test('un fallo aplaza la fila, no la pierde', async () => {
  const db = makeDb()
  const smartbc = makeSmartbc({ falla: new Error('503 temporal') })
  const r = await drainOutbox({ client: db, smartbc }, { normalizer: PASSTHROUGH })

  assert.equal(r.fallidas, 1)
  const update = db.escrituras.find((e) => e.sql.startsWith('UPDATE smartbc_outbox_cl'))
  assert.ok(update, 'la fila se actualiza en vez de borrarse')
  assert.equal(update.params[1], 1, 'y cuenta el intento')
  assert.ok(!db.escrituras.some((e) => e.sql.startsWith('DELETE FROM smartbc_outbox_cl')))
})

test('el reintento se separa exponencialmente y tiene techo', () => {
  assert.equal(esperaReintento(1), '30 seconds')
  assert.equal(esperaReintento(2), '120 seconds')
  assert.equal(esperaReintento(3), '480 seconds')
  // Sin techo, el intento 10 esperaría 87 días. Con techo, dos horas.
  assert.equal(esperaReintento(10), '7200 seconds')
})

test('el drenaje envía, retira lo que sobra y saca la fila de la bandeja', async () => {
  const smartbc = makeSmartbc({
    contactosRemotos: [
      { id: 1, external_id: `${EXT}-owner` },
      { id: 2, external_id: `${EXT}-rel-viejo` },
    ],
  })
  const db = makeDb()
  const r = await drainOutbox({ client: db, smartbc }, { normalizer: PASSTHROUGH })

  assert.equal(r.enviadas, 1)
  assert.equal(r.contactosRetirados, 1)
  assert.ok(db.escrituras.some((e) => e.sql.startsWith('DELETE FROM smartbc_outbox_cl')))
})
