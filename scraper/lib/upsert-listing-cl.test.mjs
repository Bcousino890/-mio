// Tests de upsertListingCl (upsert-listing-cl.mjs).
//
// Correr:  node --test scraper/lib/upsert-listing-cl.test.mjs
//
// Blindan el bug encontrado en producción: parseDetailPage extrae has_video y
// video_modal_url correctamente (confirmado en vivo contra MLC-3913083114), pero
// el upsert nunca los escribía en listings_cl — la señal se calculaba y se
// descartaba en el mismo request, así que la UI nunca podía saber que un
// anuncio tenía video. También cubren que el conteo de placeholders SQL calce
// con params (un desalineamiento ahí falla en producción, no en un linter).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertListingCl } from './upsert-listing-cl.mjs';

function makeClient({ existing = null } = {}) {
  const inserted = { sql: null, params: null };
  const versionLog = [];
  return {
    inserted, versionLog,
    async query(sql, params = []) {
      if (sql.includes('SELECT id, price')) return { rows: existing ? [existing] : [] };
      if (sql.includes('SELECT id FROM chile_comunas')) return { rows: [{ id: 'comuna-1' }] };
      if (sql.includes('INSERT INTO listings_cl')) {
        inserted.sql = sql; inserted.params = params;
        return { rows: [{ id: 'listing-1' }] };
      }
      if (sql.includes('INSERT INTO listing_version_log_cl')) { versionLog.push(params); return { rows: [] }; }
      if (sql.includes('listing_snapshots_cl') || sql.includes('snapshot_blobs_cl')) return { rows: [{ id: 'snap-1' }] };
      return { rows: [] };
    },
  };
}

const BASE_PARSED = {
  external_id: 'MLC-1', source_url: 'https://x', portal: 'portalinmobiliario', operation: 'sale',
  advertiser_type: 'professional', advertiser_name: 'Test Corredora', phone: null,
  price: 500000000, currency: 'CLP', bedrooms: 3, bathrooms: 2, square_meters: 100, property_type: 'casa',
  comuna: 'Las Condes', address: 'Av X 123', latitude: -33.4, longitude: -70.5, description: 'desc',
  photos: ['a', 'b'], property_code: null, advertiser_id: '123', seller_reference: null, features: ['jardin'],
};

test('los placeholders SQL ($N) del INSERT calzan 1:1 con params.length', async () => {
  const client = makeClient();
  await upsertListingCl(client, { ...BASE_PARSED, has_video: true, video_modal_url: 'https://vm/x' });
  const maxPlaceholder = Math.max(...[...client.inserted.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  assert.equal(maxPlaceholder, client.inserted.params.length);
});

test('has_video y video_modal_url se persisten en el INSERT', async () => {
  const client = makeClient();
  await upsertListingCl(client, { ...BASE_PARSED, has_video: true, video_modal_url: 'https://vm.example/video' });
  assert.match(client.inserted.sql, /has_video/);
  assert.match(client.inserted.sql, /video_modal_url/);
  assert.ok(client.inserted.params.includes(true));
  assert.ok(client.inserted.params.includes('https://vm.example/video'));
});

test('sin video/logo/posted_days_ago en el parseo → defaults null/false (no revienta)', async () => {
  const client = makeClient();
  const res = await upsertListingCl(client, BASE_PARSED); // sin has_video/video_modal_url/advertiser_logo/posted_days_ago
  assert.equal(res.changeType, 'new');
  const idx = client.inserted.params.length;
  assert.equal(client.inserted.params[idx - 5], false); // has_video
  assert.equal(client.inserted.params[idx - 4], null); // video_modal_url
  assert.equal(client.inserted.params[idx - 3], null); // advertiser_logo
  assert.equal(client.inserted.params[idx - 2], null); // advertiser_store_slug
  assert.equal(client.inserted.params[idx - 1], null); // portal_first_seen_at
});

test('advertiser_logo se persiste en el INSERT', async () => {
  const client = makeClient();
  await upsertListingCl(client, { ...BASE_PARSED, advertiser_logo: 'https://http2.mlstatic.com/storage/vis-accounts/234292543_vip-x.jpg' });
  assert.match(client.inserted.sql, /advertiser_logo/);
  assert.ok(client.inserted.params.includes('https://http2.mlstatic.com/storage/vis-accounts/234292543_vip-x.jpg'));
});

test('advertiser_store_slug (tienda oficial, H23) se persiste en el INSERT', async () => {
  const client = makeClient();
  await upsertListingCl(client, { ...BASE_PARSED, advertiser_store_slug: 'cym-propiedades' });
  assert.match(client.inserted.sql, /advertiser_store_slug/);
  assert.ok(client.inserted.params.includes('cym-propiedades'));
});

test('portal_first_seen_at: se calcula desde posted_days_ago + scrapedAt (antigüedad REAL del portal)', async () => {
  const client = makeClient();
  const scrapedAt = new Date('2026-07-24T00:00:00Z');
  await upsertListingCl(client, { ...BASE_PARSED, posted_days_ago: 28 }, { scrapedAt });
  assert.match(client.inserted.sql, /portal_first_seen_at/);
  const expected = new Date(scrapedAt.getTime() - 28 * 86400000);
  assert.ok(client.inserted.params.some((p) => p instanceof Date && p.getTime() === expected.getTime()));
});

test('portal_first_seen_at: sin posted_days_ago en el parseo, el UPDATE no pisa el valor ya guardado (COALESCE)', async () => {
  const client = makeClient({ existing: {
    id: 'listing-1', price: 500000000, advertiser_name: 'Test Corredora', photos: ['a', 'b'],
    description: 'desc', square_meters: 100, bedrooms: 3, bathrooms: 2, status: 'active', is_active: true, has_video: false,
  } });
  await upsertListingCl(client, BASE_PARSED); // sin posted_days_ago esta vez
  assert.match(client.inserted.sql, /COALESCE\(EXCLUDED\.portal_first_seen_at, listings_cl\.portal_first_seen_at\)/);
});

test('re-upsert que agrega video dispara changeType updated', async () => {
  const existing = {
    id: 'listing-1', price: 500000000, advertiser_name: 'Test Corredora', photos: ['a', 'b'],
    description: 'desc', square_meters: 100, bedrooms: 3, bathrooms: 2, status: 'active', is_active: true,
    has_video: false,
  };
  const client = makeClient({ existing });
  const res = await upsertListingCl(client, { ...BASE_PARSED, has_video: true, video_modal_url: 'https://vm/y' });
  assert.equal(res.changeType, 'updated');
});

test('re-upsert idéntico (mismo has_video) → sin changeType', async () => {
  const existing = {
    id: 'listing-1', price: 500000000, advertiser_name: 'Test Corredora', photos: ['a', 'b'],
    description: 'desc', square_meters: 100, bedrooms: 3, bathrooms: 2, status: 'active', is_active: true,
    has_video: true,
  };
  const client = makeClient({ existing });
  const res = await upsertListingCl(client, { ...BASE_PARSED, has_video: true, video_modal_url: 'https://vm/y' });
  assert.equal(res.changeType, null);
  assert.equal(client.versionLog.length, 0);
});
