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

test('sin video en el parseo → has_video false, video_modal_url null (no revienta)', async () => {
  const client = makeClient();
  const res = await upsertListingCl(client, BASE_PARSED); // sin has_video/video_modal_url
  assert.equal(res.changeType, 'new');
  const idx = client.inserted.params.length;
  assert.equal(client.inserted.params[idx - 2], false); // has_video
  assert.equal(client.inserted.params[idx - 1], null); // video_modal_url
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
