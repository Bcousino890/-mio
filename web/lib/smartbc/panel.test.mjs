// Tests del sondeo del panel comercial (panel.mjs) — la dirección SmartBC → -mio.
//
// Lo que cubren, por orden de "cuánto duele si se rompe":
//   · Se sondea sobre `changed_by=panel`. Sin eso, cada envío nuestro volvería
//     como si fuera un cambio suyo y nos devolveríamos el eco.
//   · Solo se guardan los contactos que escribió una PERSONA de su equipo.
//   · Lo que no es nuestro no se toca.
//   · Un fallo a mitad NO avanza la marca: repetir es inofensivo, saltarse una
//     ficha no.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captacionIdDe, pollPanel } from './panel.mjs'

const CAP_ID = '11111111-1111-1111-1111-111111111111'
const EXT = `mio-${CAP_ID}`

function makeDb({ desde = null } = {}) {
  const guardados = []
  const marcas = []
  return {
    guardados,
    marcas,
    async query(sql, params = []) {
      if (sql.includes('SELECT last_updated_by_user_at')) {
        return { rows: [{ last_updated_by_user_at: desde }] }
      }
      if (sql.includes('INSERT INTO smartbc_panel_cl')) {
        guardados.push(params)
        return { rows: [] }
      }
      if (sql.includes('UPDATE smartbc_poll_cl')) {
        marcas.push({ sql: sql.includes('last_error = NULL') ? 'ok' : 'error', params })
        return { rows: [] }
      }
      return { rows: [] }
    },
  }
}

function makeSmartbc({ paginas = [], contactos = {} } = {}) {
  const llamadas = []
  let i = 0
  return {
    llamadas,
    async listCaptaciones(q) {
      llamadas.push({ tipo: 'list', q })
      return paginas[i++] ?? { data: [], meta: {} }
    },
    async getContactos(externalId) {
      llamadas.push({ tipo: 'contactos', externalId })
      if (contactos[externalId] instanceof Error) throw contactos[externalId]
      return { data: contactos[externalId] ?? [] }
    },
  }
}

const FICHA = {
  external_id: EXT,
  stage: { key: 'rejected', label: 'Rechazada', stage_type: 'lost' },
  owner_confirmed: false,
  owner_name: 'María Pérez Soto',
  owner_phone: '+56912345678',
  updated_by_user_at: '2026-08-02T10:00:00Z',
}

// ─── El eco ──────────────────────────────────────────────────────────────────

test('se sondea con changed_by=panel — es lo que impide devolvernos el eco', async () => {
  // `updated_at` de SmartBC avanza TAMBIÉN con nuestros propios envíos (nos lo
  // confirmaron ellos). Sondear sin este filtro nos devolvería cada push como
  // "cambio suyo", lo reflejaríamos, eso ensuciaría la captación y la
  // volveríamos a enviar.
  const db = makeDb()
  const smartbc = makeSmartbc({ paginas: [{ data: [], meta: {} }] })
  await pollPanel({ client: db, smartbc })

  const list = smartbc.llamadas.find((l) => l.tipo === 'list')
  assert.equal(list.q.changedBy, 'panel')
})

test('la marca de la vuelta anterior se manda como updated_since', async () => {
  const db = makeDb({ desde: '2026-08-01T00:00:00.000Z' })
  const smartbc = makeSmartbc({ paginas: [{ data: [], meta: {} }] })
  await pollPanel({ client: db, smartbc })
  assert.equal(smartbc.llamadas[0].q.updatedSince, '2026-08-01T00:00:00.000Z')
})

// ─── Qué se guarda ───────────────────────────────────────────────────────────

test('solo se guardan los contactos que escribió una persona de su equipo', async () => {
  // Los `source: 'api'` los mandamos nosotros: guardarlos aquí sería tener el
  // mismo dato en dos sitios que pueden divergir.
  const db = makeDb()
  const smartbc = makeSmartbc({
    paginas: [{ data: [FICHA], meta: {} }],
    contactos: {
      [EXT]: [
        { id: 1, source: 'api', contact_name: 'María Pérez' },
        { id: 2, source: 'panel', contact_name: 'María (móvil real)', phone: '+56999999999' },
        { id: 3, source: 'panel', contact_name: 'Hijo' },
      ],
    },
  })
  const r = await pollPanel({ client: db, smartbc })

  assert.equal(r.contactos, 2)
  const guardado = JSON.parse(db.guardados[0][8])
  assert.deepEqual(guardado.map((c) => c.id), [2, 3])
})

test('la etapa y la confirmación del dueño llegan enteras', async () => {
  const db = makeDb()
  const smartbc = makeSmartbc({ paginas: [{ data: [{ ...FICHA, owner_confirmed: true }], meta: {} }] })
  await pollPanel({ client: db, smartbc })

  const [captacionId, stageKey, stageLabel, stageType, confirmado, nombre] = db.guardados[0]
  assert.equal(captacionId, CAP_ID)
  assert.equal(stageKey, 'rejected')
  assert.equal(stageLabel, 'Rechazada')
  assert.equal(stageType, 'lost')
  assert.equal(confirmado, true)
  assert.equal(nombre, 'María Pérez Soto')
})

test('una captación que no es nuestra no se toca', async () => {
  // En su CRM hay fichas de otros orígenes y de altas a mano. No tenemos dónde
  // ponerlas y no nos corresponden.
  const db = makeDb()
  const smartbc = makeSmartbc({
    paginas: [{ data: [{ ...FICHA, external_id: 'otra-integracion-42' }, { ...FICHA, external_id: null }], meta: {} }],
  })
  const r = await pollPanel({ client: db, smartbc })

  assert.equal(r.ajenas, 2)
  assert.equal(r.fichas, 0)
  assert.equal(db.guardados.length, 0)
})

test('captacionIdDe solo acepta nuestro prefijo con un uuid de verdad', () => {
  assert.equal(captacionIdDe(EXT), CAP_ID)
  assert.equal(captacionIdDe('mio-no-es-un-uuid'), null)
  assert.equal(captacionIdDe('smartbc-manual-7'), null)
  assert.equal(captacionIdDe(null), null)
})

// ─── Paginación y fallos ─────────────────────────────────────────────────────

test('se recorren las páginas hasta que se acaba el cursor', async () => {
  const db = makeDb()
  const smartbc = makeSmartbc({
    paginas: [
      { data: [FICHA], meta: { next_cursor: 'c2' } },
      { data: [{ ...FICHA, external_id: 'mio-22222222-2222-2222-2222-222222222222' }], meta: {} },
    ],
    contactos: {},
  })
  const r = await pollPanel({ client: db, smartbc })

  assert.equal(r.paginas, 2)
  assert.equal(r.fichas, 2)
  assert.equal(smartbc.llamadas.filter((l) => l.tipo === 'list')[1].q.cursor, 'c2')
})

test('la marca avanza al MÁS RECIENTE de la vuelta, no al último de la lista', async () => {
  const db = makeDb()
  const smartbc = makeSmartbc({
    paginas: [{
      data: [
        { ...FICHA, updated_by_user_at: '2026-08-02T12:00:00Z' },
        { ...FICHA, external_id: 'mio-22222222-2222-2222-2222-222222222222', updated_by_user_at: '2026-08-02T09:00:00Z' },
      ],
      meta: {},
    }],
  })
  await pollPanel({ client: db, smartbc })

  const ok = db.marcas.find((m) => m.sql === 'ok')
  assert.equal(ok.params[0], '2026-08-02T12:00:00Z', 'con la otra, la ficha de las 12:00 se releería para siempre')
})

test('si falla a mitad, la marca NO avanza', async () => {
  // Repetir una ficha es inofensivo (el upsert es idempotente). Saltársela no.
  const db = makeDb({ desde: '2026-08-01T00:00:00.000Z' })
  const smartbc = makeSmartbc({ paginas: [{ data: [FICHA], meta: { next_cursor: 'c2' } }] })
  smartbc.listCaptaciones = async (q) => {
    if (q.cursor) throw new Error('503')
    return { data: [FICHA], meta: { next_cursor: 'c2' } }
  }
  const r = await pollPanel({ client: db, smartbc })

  assert.equal(r.error, '503')
  assert.ok(!db.marcas.some((m) => m.sql === 'ok'), 'no se escribe una marca nueva')
})

test('si no se pueden leer los contactos, la ficha se guarda igual', async () => {
  const db = makeDb()
  const smartbc = makeSmartbc({
    paginas: [{ data: [FICHA], meta: {} }],
    contactos: { [EXT]: new Error('503') },
  })
  const r = await pollPanel({ client: db, smartbc })

  assert.equal(r.fichas, 1)
  // null = "esta vuelta no se leyeron", que el COALESCE del upsert distingue de
  // "no hay ninguno" y por eso no vacía los que ya hubiera.
  assert.equal(db.guardados[0][8], null)
})
