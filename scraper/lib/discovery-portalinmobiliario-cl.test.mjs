// Tests del discovery crawler (discovery-portalinmobiliario-cl.mjs · H1, Fase 1).
//
// Correr:  node --test scraper/lib/discovery-portalinmobiliario-cl.test.mjs
//
// Las funciones de URL/terminación son puras. discoverTarget se testea con
// fetch/parse/enqueue/cliente EN MEMORIA — sin red ni Postgres — verificando el
// barrido: paginación, filtro de proyectos, encolado SOLO de lo nuevo, detección
// de bajas en barrido completo y actualización de stats del target.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  operationSlug,
  comunaSlug,
  regionSlug,
  buildListUrl,
  decideContinue,
  discoverTarget,
} from './discovery-portalinmobiliario-cl.mjs'

// ── Puras ────────────────────────────────────────────────────────────────────

test('operationSlug / comunaSlug / regionSlug', () => {
  assert.equal(operationSlug('sale'), 'venta')
  assert.equal(operationSlug('rent'), 'arriendo')
  assert.equal(comunaSlug('Las Condes'), 'las-condes')
  assert.equal(comunaSlug('Ñuñoa'), 'nunoa')
  assert.equal(comunaSlug('La Reina'), 'la-reina')
  assert.equal(regionSlug('Región Metropolitana de Santiago'), 'metropolitana')
})

test('buildListUrl: página 1 sin sufijo, resto con _Desde_N', () => {
  const base = { comunaSlug: 'las-condes', regionSlug: 'metropolitana', operation: 'sale', propertyType: 'casa' }
  assert.equal(
    buildListUrl({ ...base, offset: 0 }),
    'https://www.portalinmobiliario.com/venta/casa/propiedades-usadas/las-condes-metropolitana'
  )
  assert.equal(
    buildListUrl({ ...base, offset: 48 }),
    'https://www.portalinmobiliario.com/venta/casa/propiedades-usadas/las-condes-metropolitana/_Desde_49_NoIndex_True'
  )
  assert.equal(
    buildListUrl({ ...base, operation: 'rent', offset: 96 }),
    'https://www.portalinmobiliario.com/arriendo/casa/propiedades-usadas/las-condes-metropolitana/_Desde_97_NoIndex_True'
  )
})

test('decideContinue: página vacía → completa', () => {
  assert.deepEqual(decideContinue({ page: 3, pageItems: 0, pageCount: 42, maxPages: 60 }), { stop: true, completed: true, reason: null })
})

test('decideContinue: alcanza pageCount → completa', () => {
  assert.deepEqual(decideContinue({ page: 42, pageItems: 48, pageCount: 42, maxPages: 60 }), { stop: true, completed: true, reason: null })
})

test('decideContinue: sigue si hay más páginas', () => {
  assert.deepEqual(decideContinue({ page: 2, pageItems: 48, pageCount: 42, maxPages: 60 }), { stop: false, completed: false, reason: null })
})

test('decideContinue: tope maxPages por debajo de pageCount → INCOMPLETO', () => {
  const d = decideContinue({ page: 5, pageItems: 48, pageCount: 42, maxPages: 5 })
  assert.equal(d.stop, true)
  assert.equal(d.completed, false)
  assert.match(d.reason, /maxPages/)
})

// ── discoverTarget (integración en memoria) ──────────────────────────────────

const TARGET = {
  id: 'target-1', comuna_id: 'comuna-lc', comuna_name: 'Las Condes',
  region: 'Región Metropolitana de Santiago', operation: 'sale', property_type: 'casa',
}

function listing(id, extra = {}) {
  return { external_id: id, source_url: `https://www.portalinmobiliario.com/${id}`, is_development: false, ...extra }
}

/** Fake client: enruta las 4 consultas de discoverTarget sobre un store en memoria. */
function makeClient({ known = [], activeInComuna = [] }) {
  const knownSet = new Set(known)
  const state = { delistedIds: [], versionLogged: [], stats: null }
  return {
    state,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim()
      if (q.startsWith('SELECT external_id FROM listings_cl')) {
        const ids = params[0]
        return { rows: ids.filter((id) => knownSet.has(id)).map((id) => ({ external_id: id })) }
      }
      if (q.startsWith('SELECT id FROM listings_cl')) {
        // markDelisted: activos de la comuna no vistos este barrido
        const seen = new Set(params[3])
        return { rows: activeInComuna.filter((a) => !seen.has(a.external_id)).map((a) => ({ id: a.id })) }
      }
      if (q.startsWith('UPDATE listings_cl SET is_active = false')) {
        state.delistedIds = params[0]
        return { rowCount: params[0].length }
      }
      if (q.startsWith('INSERT INTO listing_version_log_cl')) {
        state.versionLogged = params[0]
        return { rowCount: params[0].length }
      }
      if (q.startsWith('UPDATE scrape_targets_cl SET')) {
        state.stats = { targetId: params[0], scrapedAt: params[1], completed: params[2], listingCount: params[3], portalTotal: params[4] }
        return { rowCount: 1 }
      }
      throw new Error(`Fake client: consulta no manejada → ${q.slice(0, 80)}`)
    },
  }
}

test('discoverTarget: pagina, filtra proyectos, encola solo lo nuevo, marca bajas y stats', async () => {
  // Página 1: 3 anuncios (uno proyecto que se filtra). MLC-A ya conocido.
  // Página 2: 1 anuncio nuevo, y al ser < page_size el barrido termina completo.
  const pages = {
    0: { listings: [listing('MLC-A'), listing('MLC-B'), listing('MLC-P', { is_development: true })], meta: { total: 3, pageCount: 2 } },
    48: { listings: [listing('MLC-C')], meta: { total: 3, pageCount: 2 } },
  }
  // MLC-A ya está; MLC-Z está activo en la comuna pero NO reaparece → baja.
  const client = makeClient({ known: ['MLC-A'], activeInComuna: [{ id: 'uuid-z', external_id: 'MLC-Z' }, { id: 'uuid-a', external_id: 'MLC-A' }] })

  const enqueued = []
  const res = await discoverTarget(client, TARGET, {
    fetch: async (url) => ({ ok: true, html: url.includes('_Desde_49') ? 'P2' : 'P1' }),
    parseList: (html) => (html === 'P2' ? pages[48].listings : pages[0].listings),
    parseMeta: (html) => (html === 'P2' ? pages[48].meta : pages[0].meta),
    enqueueDetail: async (id, url) => enqueued.push(id),
    sleep: async () => {},
  })

  assert.equal(res.completed, true)
  assert.equal(res.pages, 2)
  assert.equal(res.seen, 3) // A, B, C (el proyecto P se filtró)
  // Encola solo NUEVOS y no-proyecto: B y C (A ya conocido, P filtrado)
  assert.deepEqual(enqueued.sort(), ['MLC-B', 'MLC-C'])
  // Baja: MLC-Z (activo, no reapareció). MLC-A sí apareció → no se da de baja.
  assert.equal(res.delisted, 1)
  assert.deepEqual(client.state.delistedIds, ['uuid-z'])
  assert.deepEqual(client.state.versionLogged, ['uuid-z'])
  // Stats del target
  assert.equal(client.state.stats.completed, true)
  assert.equal(client.state.stats.listingCount, 3)
  assert.equal(client.state.stats.portalTotal, 3)
})

test('discoverTarget: fetch que falla en página 1 → incompleto, sin bajas', async () => {
  const client = makeClient({ known: [], activeInComuna: [{ id: 'uuid-z', external_id: 'MLC-Z' }] })
  const res = await discoverTarget(client, TARGET, {
    fetch: async () => ({ ok: false, reason: 'HTTP 429' }),
    enqueueDetail: async () => {},
    sleep: async () => {},
  })
  assert.equal(res.completed, false)
  assert.equal(res.pages, 0)
  assert.match(res.reason, /429/)
  assert.equal(res.delisted, 0) // barrido incompleto → NO se marcan bajas
  assert.equal(client.state.delistedIds.length, 0)
  assert.equal(client.state.stats.completed, false) // igual registra last_run_at
})

test('discoverTarget: barrido completo con 0 vistos NO da de baja media comuna', async () => {
  const client = makeClient({ known: [], activeInComuna: [{ id: 'uuid-z', external_id: 'MLC-Z' }] })
  const res = await discoverTarget(client, TARGET, {
    fetch: async () => ({ ok: true, html: 'P1' }),
    parseList: () => [], // página vacía → completo pero sin resultados
    parseMeta: () => ({ total: 0, pageCount: 1 }),
    enqueueDetail: async () => {},
    sleep: async () => {},
  })
  assert.equal(res.completed, true)
  assert.equal(res.seen, 0)
  assert.equal(res.delisted, 0) // guardado: seen.size === 0 → no marca bajas
  assert.equal(client.state.delistedIds.length, 0)
})
