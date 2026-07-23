// Tests de worker-cl.mjs (handlers de jobs). No existía suite para este archivo.
//
// Correr:  node --test scraper/worker-cl.test.mjs
//
// Blinda el bug encontrado en producción: handleDetailJob NUNCA pasaba ufRate
// a upsertListingCl — resolvePriceClp() (to-listing.mjs) devuelve null para
// CUALQUIER anuncio con currency='UF' sin ufRate, que es la inmensa mayoría de
// los anuncios chilenos (se publican en UF). El precio en CLP quedaba NULL en
// toda la base, visible en la ficha como "—", pese a que price_uf sí se
// guardaba (confirmado en vivo contra MLC-2020551727: price=18000,
// currency='UF', y sin ufRate upsertListingCl habría guardado price=null).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleDetailJob } from './worker-cl.mjs';

const PARSED_UF_LISTING = {
  external_id: 'MLC-1', source_url: 'https://x/MLC-1-slug-_JM', portal: 'portalinmobiliario',
  operation: 'sale', advertiser_type: 'professional', advertiser_name: 'Property Partners',
  price: 18000, currency: 'UF', bedrooms: 4, bathrooms: 3, square_meters: 507,
  property_type: 'casa', comuna: 'Las Condes', photos: ['a.jpg'],
};

test('handleDetailJob pasa ufRate al upsert (el bug: antes nunca lo pasaba)', async () => {
  let capturedOptions = null;
  const res = await handleDetailJob(
    {},
    { externalId: 'MLC-1', sourceUrl: 'https://x/MLC-1-slug-_JM' },
    {
      fetch: async () => ({ ok: true, html: '<html></html>' }),
      parse: async () => PARSED_UF_LISTING,
      upsert: async (client, parsed, options) => { capturedOptions = options; return { listingId: 'l1', changeType: 'new' }; },
      getUfRate: async () => ({ ok: true, rate: 38500, date: '2026-07-24' }),
    }
  );
  assert.equal(res.ok, true);
  assert.equal(capturedOptions.ufRate, 38500);
  assert.equal(capturedOptions.ufRateDate, '2026-07-24');
});

test('handleDetailJob: la tasa UF resuelve un precio CLP real (no null)', async () => {
  // Reproduce el bug completo end-to-end: sin el fix, price CLP quedaba null
  // pese a currency='UF' + price=18000 — aquí se verifica el cálculo real.
  const { resolvePriceClp } = await import('./lib/to-listing.mjs');
  let savedPriceClp = null;
  await handleDetailJob(
    {},
    { externalId: 'MLC-1', sourceUrl: 'https://x/MLC-1-slug-_JM' },
    {
      fetch: async () => ({ ok: true, html: '<html></html>' }),
      parse: async () => PARSED_UF_LISTING,
      upsert: async (client, parsed, options) => {
        savedPriceClp = resolvePriceClp(parsed, options.ufRate);
        return { listingId: 'l1', changeType: 'new' };
      },
      getUfRate: async () => ({ ok: true, rate: 38500, date: '2026-07-24' }),
    }
  );
  assert.equal(savedPriceClp, Math.round(18000 * 38500)); // 712.500.000 — no null
});

test('handleDetailJob: si getUfRate falla, sigue el upsert sin ufRate (no revienta, no bloquea el pipeline)', async () => {
  let capturedOptions = 'NO_LLAMADO';
  const res = await handleDetailJob(
    {},
    { externalId: 'MLC-1', sourceUrl: 'https://x/MLC-1-slug-_JM' },
    {
      fetch: async () => ({ ok: true, html: '<html></html>' }),
      parse: async () => PARSED_UF_LISTING,
      upsert: async (client, parsed, options) => { capturedOptions = options; return { listingId: 'l1', changeType: 'new' }; },
      getUfRate: async () => ({ ok: false, reason: 'mindicador.cl caído' }),
    }
  );
  assert.equal(res.ok, true);
  assert.deepEqual(capturedOptions, {}); // sin ufRate/ufRateDate — upsertListingCl usa sus defaults (null)
});

test('handleDetailJob: fetch fallido no llama a getUfRate (evita el fetch de UF si igual no hay ficha)', async () => {
  let ufCalled = false;
  const res = await handleDetailJob(
    {},
    { externalId: 'MLC-1', sourceUrl: 'https://x/MLC-1-slug-_JM' },
    {
      fetch: async () => ({ ok: false, reason: 'HTTP 404' }),
      getUfRate: async () => { ufCalled = true; return { ok: true, rate: 38500, date: '2026-07-24' }; },
    }
  );
  assert.equal(res.ok, false);
  assert.equal(ufCalled, false);
});
