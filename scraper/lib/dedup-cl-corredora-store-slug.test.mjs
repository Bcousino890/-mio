// Tests del slug de tienda oficial en runCorredoraConsolidationCl (dedup-cl.mjs · H23).
//
// Correr:  node --test scraper/lib/dedup-cl-corredora-store-slug.test.mjs
//
// `advertiser_store_slug` (persistido en listings_cl desde 0089, extraído del
// enlace "Ir a la tienda oficial de..." en cualquier ficha ya scrapeada) se
// propaga a corredoras_cl.portal_store_slug con el MISMO criterio que el logo
// (0075/dedup-cl-corredora-logo.test.mjs): el más reciente no nulo entre los
// anuncios de la corredora, y backfill sin pisar un slug ya guardado.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runCorredoraConsolidationCl } from './dedup-cl.mjs'

function makeClient({ pendingAdvertiserIds, family, existingCorredora = null }) {
  const state = { inserted: null, storeUpdates: [] }
  return {
    state,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim()
      if (q.startsWith('SELECT DISTINCT advertiser_id')) {
        return { rows: pendingAdvertiserIds.map((advertiser_id) => ({ advertiser_id })) }
      }
      if (q.startsWith('SELECT id, corredora_id, advertiser_name, advertiser_logo')) {
        return { rows: family }
      }
      if (q.startsWith('INSERT INTO corredoras_cl')) {
        state.inserted = { sql: q, params }
        return { rows: [{ id: existingCorredora?.id ?? 'corredora-1' }] }
      }
      if (q.startsWith('UPDATE corredoras_cl SET logo_url')) return { rowCount: 1 }
      if (q.startsWith('UPDATE corredoras_cl SET portal_store_slug')) {
        state.storeUpdates.push({ id: params[0], slug: params[1] })
        return { rowCount: 1 }
      }
      if (q.startsWith('UPDATE listings_cl SET corredora_id')) return { rowCount: family.length }
      if (q.startsWith('SELECT l.phone')) return { rows: [] } // refreshCorredoraMetrics
      if (q.startsWith('UPDATE corredoras_cl SET') && q.includes('phones =')) return { rowCount: 1 }
      return { rows: [] }
    },
  }
}

const L = (id, extra = {}) => ({
  id, corredora_id: null, advertiser_name: 'CyM Propiedades', advertiser_logo: null,
  advertiser_store_slug: null, phone: null, comuna_id: 'c1', is_active: true,
  first_seen_at: '2026-01-01', last_seen_at: '2026-01-01', taken_down_at: null, property_cl_id: null,
  ...extra,
})

test('crea la corredora con el slug de tienda más reciente no nulo', async () => {
  const family = [
    L('l1', { advertiser_store_slug: null, last_seen_at: '2026-01-01' }),
    L('l2', { advertiser_store_slug: 'cym-propiedades-viejo', last_seen_at: '2026-01-02' }),
    L('l3', { advertiser_store_slug: 'cym-propiedades', last_seen_at: '2026-01-05' }), // el más reciente
  ]
  const client = makeClient({ pendingAdvertiserIds: ['adv-1'], family })
  const res = await runCorredoraConsolidationCl(client)

  assert.equal(res.created, 1)
  assert.ok(client.state.inserted.sql.includes('portal_store_slug'))
  assert.ok(client.state.inserted.params.includes('cym-propiedades'))
})

test('corredora YA existente sin slug: se rellena (backfill)', async () => {
  const family = [
    L('l1', { corredora_id: 'corredora-existente', advertiser_store_slug: 'remax-diamante' }),
  ]
  const client = makeClient({ pendingAdvertiserIds: ['adv-2'], family })
  await runCorredoraConsolidationCl(client)

  assert.equal(client.state.storeUpdates.length, 1)
  assert.equal(client.state.storeUpdates[0].id, 'corredora-existente')
  assert.equal(client.state.storeUpdates[0].slug, 'remax-diamante')
})

test('corredora existente sin slug disponible en sus anuncios: no intenta update', async () => {
  const family = [
    L('l1', { corredora_id: 'corredora-existente', advertiser_store_slug: null }),
  ]
  const client = makeClient({ pendingAdvertiserIds: ['adv-3'], family })
  await runCorredoraConsolidationCl(client)

  assert.equal(client.state.storeUpdates.length, 0)
})

test('logo y slug se propagan juntos sin pisarse entre sí', async () => {
  const family = [
    L('l1', { corredora_id: 'corredora-existente', advertiser_logo: 'https://.../logo.jpg', advertiser_store_slug: 'cym-propiedades' }),
  ]
  const client = makeClient({ pendingAdvertiserIds: ['adv-4'], family })
  await runCorredoraConsolidationCl(client)

  assert.equal(client.state.storeUpdates.length, 1)
  assert.equal(client.state.storeUpdates[0].slug, 'cym-propiedades')
})
