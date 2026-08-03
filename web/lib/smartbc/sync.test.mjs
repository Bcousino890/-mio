// Tests del sincronizador -mio → SmartBC (smartbc-sync-cl.mjs).
//
// Correr:  node --test scraper/lib/smartbc-sync-cl.test.mjs
//
// Cubren los criterios de aceptación que dependen de la ORQUESTACIÓN (no del
// mapeo): reenviar sin cambios no escribe, un cambio de precio manda solo ese
// campo, un elemento malo no tumba el lote, y el log refleja lo ocurrido.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  badIndicesFrom,
  idempotencyKeyFor,
  loadListings,
  planItem,
  syncOnce,
} from './sync.mjs'
import { buildCaptacionPayload, externalIdFor, payloadHash } from './mapper.mjs'
import { PASSTHROUGH } from './catalogo.mjs'

const CAP_ID = '11111111-1111-1111-1111-111111111111'
const PROP_ID = 'pppppppp-0000-0000-0000-000000000001'
const LST_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

const CAP = {
  id: CAP_ID,
  property_cl_id: PROP_ID,
  listing_cl_id: LST_ID,
  source_url: 'https://www.portalinmobiliario.com/MLC-999',
  title: 'Casa en Las Condes',
  operation: 'sale',
  property_type: 'casa',
  price_raw: 450000000,
  currency: 'CLP',
  sqm: 320,
  bedrooms: 4,
  bathrooms: 3,
  address: 'Av. Apoquindo 1234',
  comuna_label: 'Las Condes',
  sii_comuna_code: '15108',
  sii_rol: '795-198',
  match_score: 0.97,
  match_confidence: 'confirmed',
  match_verified: true,
  owner_name: 'María Pérez',
  owner_rut: '12345678-9',
  phones: [{ numero: '+56912345678', categoria: 'probable', whatsapp: true, calidad: 9 }],
  emails: [],
  relacionados: [],
  photos: [],
  selected_photo_urls: [],
  raw_extracted: {},
  stage: 'contact_found',
  needs_review: false,
  comuna_name: 'Las Condes',
  comuna_region: 'Región Metropolitana de Santiago',
  property_localidad: 'El Golf',
  payload_hash: null,
  last_payload: null,
  synced_at: null,
}

const LISTING = {
  id: LST_ID,
  portal: 'portalinmobiliario',
  source_type: 'portal',
  external_id: 'MLC-999',
  source_url: 'https://www.portalinmobiliario.com/MLC-999',
  operation: 'sale',
  advertiser_name: 'Corredora X',
  corredora_id: 'cor-1',
  corredora_name: 'Corredora X',
  price: 460000000,
  currency: 'CLP',
  status: 'active',
  property_cl_id: PROP_ID,
  features: [],
  photos: [],
  stored_photos: [],
}

/** pg simulado: devuelve las captaciones/listings dados y graba los upserts. */
function makeDb({ captaciones = [CAP], listings = [LISTING] } = {}) {
  const writes = []
  return {
    writes,
    async query(sql, params = []) {
      if (sql.includes('FROM captaciones_cl')) return { rows: captaciones }
      if (sql.includes('FROM listings_cl')) return { rows: listings }
      if (sql.includes('INSERT INTO smartbc_sync_cl')) {
        writes.push({ sql, params })
        return { rows: [] }
      }
      return { rows: [] }
    },
  }
}

/** SmartbcClient simulado: encola respuestas de /batch y graba las llamadas. */
function makeSmartbc(responder) {
  const calls = []
  return {
    calls,
    async batch(items, opts) {
      calls.push({ items, opts })
      return responder(items, opts, calls.length - 1)
    },
  }
}

const okBatch = (accion = 'created') => (items) => ({
  status: 200,
  requestId: 'req_batch_1',
  data: items.map((it, index) => ({
    index,
    ok: true,
    external_id: it.external_id,
    action: accion,
    id: `sbc-${index}`,
    admin_url: `https://portal.bcousinoprop.com/cl/admin/captaciones/sbc-${index}`,
    changed_fields: accion === 'created' ? [] : ['price'],
    protected_fields: [],
    warnings: [],
  })),
})

// ─── Planificación ───────────────────────────────────────────────────────────

test('una captación nunca enviada se planifica como alta completa', () => {
  const plan = planItem(CAP, [LISTING], {})
  assert.equal(plan.action, 'create')
  assert.equal(plan.item.external_id, externalIdFor(CAP_ID))
  assert.ok(plan.item.owner, 'el alta lleva la ficha entera')
})

test('reenviar sin cambios no produce petición alguna', () => {
  const payload = buildCaptacionPayload({
    captacion: CAP,
    comuna: { name: CAP.comuna_name, region: CAP.comuna_region },
    property: { localidad: CAP.property_localidad },
    listings: [LISTING],
  })
  const yaSincronizada = {
    ...CAP, payload_hash: payloadHash(payload), last_payload: payload, synced_at: new Date(),
  }
  const plan = planItem(yaSincronizada, [LISTING], {})
  assert.equal(plan.action, 'unchanged')
  assert.equal(plan.item, null)
})

test('cambiar el precio produce un PATCH con solo ese campo (más el escudo)', () => {
  const payload = buildCaptacionPayload({
    captacion: CAP,
    comuna: { name: CAP.comuna_name, region: CAP.comuna_region },
    property: { localidad: CAP.property_localidad },
    listings: [LISTING],
  })
  const conNuevoPrecio = {
    ...CAP,
    price_raw: 470000000,
    payload_hash: payloadHash(payload),
    last_payload: payload,
    synced_at: new Date(),
  }
  const plan = planItem(conNuevoPrecio, [LISTING], {})
  assert.equal(plan.action, 'update')
  // source_site va siempre como escudo: sin él, SmartBC lo pisa con su slug.
  assert.deepEqual(Object.keys(plan.item).sort(), ['external_id', 'price', 'source_site'])
  assert.equal(plan.item.price, 470000000)
})

// ─── Idempotencia ────────────────────────────────────────────────────────────

test('la Idempotency-Key depende del contenido: mismo lote, misma clave', () => {
  const items = [{ external_id: 'mio-1', price: 100 }]
  assert.equal(idempotencyKeyFor(items), idempotencyKeyFor([...items]))
})

test('un lote distinto produce otra clave (imposible el 409 de "misma clave, otro cuerpo")', () => {
  assert.notEqual(
    idempotencyKeyFor([{ external_id: 'mio-1', price: 100 }]),
    idempotencyKeyFor([{ external_id: 'mio-1', price: 200 }]),
  )
})

// ─── Agrupación de anuncios ──────────────────────────────────────────────────

test('los anuncios se agrupan por property_cl e incluyen el que originó la captación', async () => {
  const otro = { ...LISTING, id: 'otro', source_url: 'https://otra.cl/1', property_cl_id: PROP_ID }
  const suelto = { ...LISTING, id: 'suelto', source_url: 'https://x.cl/9', property_cl_id: null }
  const db = makeDb({ listings: [LISTING, otro, suelto] })
  const mapa = await loadListings(db, [CAP])
  const ids = mapa.get(CAP_ID).map((l) => l.id)
  assert.deepEqual(ids.sort(), [LST_ID, 'otro'].sort(), 'el de otro inmueble no entra')
})

// ─── Corrida completa ────────────────────────────────────────────────────────

test('un alta nueva se envía y se registra con su request_id y admin_url', async () => {
  const db = makeDb()
  const smartbc = makeSmartbc(okBatch('created'))
  const summary = await syncOnce({ client: db, smartbc }, { normalizer: PASSTHROUGH })

  assert.deepEqual(
    { total: summary.total, created: summary.created, failed: summary.failed },
    { total: 1, created: 1, failed: 0 },
  )
  assert.equal(smartbc.calls.length, 1)
  assert.ok(smartbc.calls[0].opts.idempotencyKey, 'toda escritura automática lleva Idempotency-Key')

  const write = db.writes.at(-1)
  assert.ok(write.sql.includes('INSERT INTO smartbc_sync_cl'))
  assert.ok(write.params.includes(externalIdFor(CAP_ID)))
  assert.ok(write.params.includes('created'))
  assert.ok(write.params.some((p) => typeof p === 'string' && p.includes('/cl/admin/captaciones/')))
})

test('una captación sin cambios no llega a la API pero sí queda registrada', async () => {
  const payload = buildCaptacionPayload({
    captacion: CAP,
    comuna: { name: CAP.comuna_name, region: CAP.comuna_region },
    property: { localidad: CAP.property_localidad },
    listings: [LISTING],
  })
  const db = makeDb({
    captaciones: [{ ...CAP, payload_hash: payloadHash(payload), last_payload: payload, synced_at: new Date() }],
  })
  const smartbc = makeSmartbc(okBatch())
  const summary = await syncOnce({ client: db, smartbc }, { normalizer: PASSTHROUGH })

  assert.equal(summary.unchanged, 1)
  assert.equal(smartbc.calls.length, 0, 'no se gasta cuota en lo que no cambió')
  assert.ok(db.writes.at(-1).params.includes('unchanged'))
})

test('un lote de 100 con un elemento inválido procesa los 99 buenos y reporta el malo', async () => {
  const captaciones = Array.from({ length: 100 }, (_, i) => ({
    ...CAP,
    id: `${i}`.padStart(8, '0') + '-1111-1111-1111-111111111111',
    property_cl_id: `prop-${i}`,
    listing_cl_id: null,
  }))
  const db = makeDb({ captaciones, listings: [] })
  const smartbc = makeSmartbc((items) => ({
    status: 200,
    requestId: 'req_batch_mixto',
    data: items.map((it, index) =>
      index === 42
        ? { index, ok: false, external_id: it.external_id, error: { code: 'validation_error', message: 'commune inválida' } }
        : { index, ok: true, external_id: it.external_id, action: 'created', id: `sbc-${index}` }),
  }))

  const summary = await syncOnce({ client: db, smartbc }, { normalizer: PASSTHROUGH })
  assert.equal(smartbc.calls.length, 1, 'un solo lote de 100')
  assert.equal(smartbc.calls[0].items.length, 100)
  assert.equal(summary.created, 99)
  assert.equal(summary.failed, 1)

  const fallido = db.writes.find((w) => w.params.includes('validation_error'))
  assert.ok(fallido, 'el elemento malo queda registrado con su código de error')
})

test('badIndicesFrom saca de details qué elementos del lote son inválidos', () => {
  // Formato real devuelto por la API (comprobado en dry-run contra producción).
  const err = {
    status: 400,
    code: 'validation_error',
    details: [
      { field: 'items.1.property_type', message: 'Invalid input' },
      { field: 'items.3.currency', message: 'Invalid input' },
      { field: 'otra.cosa', message: 'ignorar' },
    ],
  }
  const malos = badIndicesFrom(err)
  assert.deepEqual([...malos.keys()], [1, 3])
  assert.match(malos.get(1)[0], /property_type/)
})

test('un elemento con enum inválido no bloquea al resto: se aparta y el lote se reenvía', async () => {
  // La API valida el cuerpo ENTERO antes de procesar, así que un enum malo
  // devuelve 400 para todo el lote. El sincronizador aparta el señalado y
  // reintenta con los buenos — si no, una captación sucia bloquearía a las 99
  // restantes en cada corrida.
  const captaciones = [0, 1, 2].map((i) => ({
    ...CAP,
    id: `${i}`.padStart(8, '0') + '-3333-3333-3333-333333333333',
    property_cl_id: `prop-${i}`,
    listing_cl_id: null,
  }))
  const db = makeDb({ captaciones, listings: [] })

  let ronda = 0
  const smartbc = makeSmartbc((items) => {
    if (ronda++ === 0) {
      throw Object.assign(new Error('El cuerpo de la petición no es válido'), {
        status: 400,
        code: 'validation_error',
        requestId: 'req_400',
        details: [{ field: 'items.1.property_type', message: 'Invalid input' }],
      })
    }
    return {
      status: 200,
      requestId: 'req_ok',
      data: items.map((it, index) => ({ index, ok: true, external_id: it.external_id, action: 'created' })),
    }
  })

  const summary = await syncOnce({ client: db, smartbc }, { normalizer: PASSTHROUGH })
  assert.equal(smartbc.calls.length, 2, 'un reintento tras apartar el malo')
  assert.equal(smartbc.calls[1].items.length, 2, 'reenvía solo los buenos')
  assert.equal(summary.created, 2)
  assert.equal(summary.failed, 1)

  const fallido = db.writes.find((w) => w.params.includes('validation_error'))
  assert.ok(fallido, 'el apartado queda registrado con su campo exacto')
  assert.ok(fallido.params.some((p) => typeof p === 'string' && p.includes('property_type')))
})

test('si el lote entero falla, todas sus captaciones quedan marcadas como fallidas', async () => {
  const db = makeDb()
  const err = Object.assign(new Error('clave revocada'), { status: 401, code: 'unauthorized', requestId: 'req_401' })
  const smartbc = makeSmartbc(() => { throw err })

  const summary = await syncOnce({ client: db, smartbc }, { normalizer: PASSTHROUGH })
  assert.equal(summary.failed, 1)
  const write = db.writes.at(-1)
  assert.ok(write.params.includes('unauthorized'))
  assert.ok(write.params.includes(401))
})

test('en dry-run no se guarda el hash: nada se escribió en SmartBC', async () => {
  const db = makeDb()
  const smartbc = makeSmartbc(okBatch('created'))
  const summary = await syncOnce({ client: db, smartbc }, { dryRun: true, normalizer: PASSTHROUGH })

  assert.equal(summary.created, 1)
  assert.equal(smartbc.calls[0].opts.dryRun, true)
  assert.equal(db.writes.length, 0, 'dar por sincronizada una ficha que no subió la dejaría fuera para siempre')
})

test('más de 100 pendientes se parten en lotes de 100', async () => {
  const captaciones = Array.from({ length: 150 }, (_, i) => ({
    ...CAP,
    id: `${i}`.padStart(8, '0') + '-2222-2222-2222-222222222222',
    property_cl_id: `prop-${i}`,
    listing_cl_id: null,
  }))
  const db = makeDb({ captaciones, listings: [] })
  const smartbc = makeSmartbc(okBatch('created'))
  await syncOnce({ client: db, smartbc }, { limit: 150, normalizer: PASSTHROUGH })

  assert.deepEqual(smartbc.calls.map((c) => c.items.length), [100, 50])
  assert.notEqual(
    smartbc.calls[0].opts.idempotencyKey,
    smartbc.calls[1].opts.idempotencyKey,
    'cada lote lleva su propia clave',
  )
})

test('el catálogo se descarga una vez por corrida y normaliza la comuna', async () => {
  const db = makeDb()
  const pedidos = []
  const smartbc = {
    calls: [],
    async catalogo(tipo, query = {}) {
      pedidos.push(tipo)
      if (tipo === 'regiones') return { data: [{ name: 'Metropolitana', code: 'RM' }] }
      if (tipo === 'comunas') return { data: [{ name: 'Las Condes', region: 'Metropolitana' }] }
      return { data: [{ name: 'El Golf' }] }
    },
    async batch(items, opts) {
      this.calls.push({ items, opts })
      return okBatch('created')(items)
    },
  }

  await syncOnce({ client: db, smartbc })
  assert.deepEqual(pedidos, ['regiones', 'comunas', 'zonas'], 'una descarga, no una por captación')

  const enviado = smartbc.calls[0].items[0]
  assert.equal(enviado.commune, 'Las Condes')
  assert.equal(enviado.region, 'Metropolitana', 'la región sale del catálogo, no de nuestra taxonomía')
  assert.equal(enviado.zone, 'El Golf')
})

test('una comuna fuera del catálogo no viaja y se reporta al final', async () => {
  const db = makeDb({ captaciones: [{ ...CAP, comuna_name: 'Comuna Inventada' }] })
  const smartbc = {
    calls: [],
    async catalogo(tipo) {
      if (tipo === 'regiones') return { data: [{ name: 'Metropolitana' }] }
      if (tipo === 'comunas') return { data: [{ name: 'Las Condes', region: 'Metropolitana' }] }
      return { data: [] }
    },
    async batch(items, opts) {
      this.calls.push({ items, opts })
      return okBatch('created')(items)
    },
  }

  const summary = await syncOnce({ client: db, smartbc })
  assert.equal(smartbc.calls[0].items[0].commune, undefined, 'no se cuela como texto libre')
  assert.ok(summary.faltantesCatalogo.some((l) => l.includes('Comuna Inventada')))
})

test('si el catálogo no se puede descargar, la ubicación no viaja (no texto libre)', async () => {
  const db = makeDb()
  const smartbc = {
    calls: [],
    async catalogo() { throw new Error('503') },
    async batch(items, opts) {
      this.calls.push({ items, opts })
      return okBatch('created')(items)
    },
  }

  const avisos = []
  await syncOnce({ client: db, smartbc }, { log: (m) => avisos.push(m) })
  assert.equal(smartbc.calls[0].items[0].commune, undefined)
  assert.ok(avisos.some((m) => m.includes('catálogo')), 'y se avisa de que pasó')
})

test('sin pendientes no se llama a la API', async () => {
  const db = makeDb({ captaciones: [] })
  const smartbc = makeSmartbc(okBatch())
  const summary = await syncOnce({ client: db, smartbc }, { normalizer: PASSTHROUGH })
  assert.equal(summary.total, 0)
  assert.equal(smartbc.calls.length, 0)
})

test('--force llega al SQL como parámetro, no como otra consulta', async () => {
  // El reenvío deliberado existe para cuando cambia el MAPEO y no el dato:
  // sin él, una ficha que ya nadie toca se queda con el payload viejo para
  // siempre. Va como parámetro de la misma consulta a propósito — dos SQL
  // con criterios distintos de "qué está pendiente" acabarían divergiendo.
  const vistos = []
  const db = {
    async query(sql, params = []) {
      if (sql.includes('FROM captaciones_cl')) { vistos.push(params); return { rows: [] } }
      return { rows: [] }
    },
  }
  const smartbc = makeSmartbc(okBatch())

  await syncOnce({ client: db, smartbc }, { normalizer: PASSTHROUGH })
  assert.deepEqual(vistos[0], [100, false], 'por defecto NO reenvía lo que no cambió')

  await syncOnce({ client: db, smartbc }, { normalizer: PASSTHROUGH, force: true })
  assert.deepEqual(vistos[1], [100, true])
})

test('reenviar en force lo que no cambió sigue sin gastar cuota', async () => {
  // force amplía lo que se REVISA, no lo que se envía: el hash sigue mandando.
  const payload = buildCaptacionPayload({
    captacion: CAP,
    comuna: { name: CAP.comuna_name, region: CAP.comuna_region },
    property: { localidad: CAP.property_localidad },
    listings: [LISTING],
  }, { normalizer: PASSTHROUGH })
  const db = makeDb({
    captaciones: [{ ...CAP, payload_hash: payloadHash(payload), last_payload: payload, synced_at: new Date() }],
  })
  const smartbc = makeSmartbc(okBatch())
  const summary = await syncOnce({ client: db, smartbc }, { normalizer: PASSTHROUGH, force: true })

  assert.equal(summary.unchanged, 1)
  assert.equal(smartbc.calls.length, 0, 'nada que mandar es nada que mandar, aunque se fuerce')
})
