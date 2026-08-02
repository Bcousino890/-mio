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
import { handleDetailJob, handleDedupClusterJob } from './worker-cl.mjs';

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
      // También se inyecta la del dólar: sin esto el test llamaba a la de verdad
      // (petición de red real), así que fallaba o pasaba según hubiera internet.
      getUsdRate: async () => ({ ok: false, reason: 'mindicador.cl caído' }),
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

test('handleDetailJob: un 404 cierra el job (el anuncio ya no existe), no se reintenta', async () => {
  const res = await handleDetailJob(
    {},
    { externalId: 'MLC-1', sourceUrl: 'https://x/MLC-1-slug-_JM' },
    { fetch: async () => ({ ok: false, status: 404, reason: 'HTTP 404' }) }
  );
  assert.equal(res.ok, false);
  assert.match(res.reason, /404/);
});

test('handleDetailJob: un fallo de red LANZA, para que la ficha se reintente en vez de perderse', async () => {
  // Antes devolvía {ok:false} y pg-boss daba el job por COMPLETADO: con el
  // circuito abierto se tiraban lotes enteros de fichas en milisegundos, y un
  // anuncio nuevo no se volvía a intentar hasta el siguiente barrido completo.
  await assert.rejects(
    () => handleDetailJob(
      {},
      { externalId: 'MLC-1', sourceUrl: 'https://x/MLC-1-slug-_JM' },
      { fetch: async () => ({ ok: false, status: 0, reason: 'circuit_open:www.portalinmobiliario.com (reintentar en 168s)' }) }
    ),
    /circuit_open/
  );
});

// ─── dedup-cluster ───────────────────────────────────────────────────────────

test('handleDedupClusterJob: re-sincroniza los agregados de property_cl al final', async () => {
  // Blinda el bug de producción: is_active/listing_count/corredora_count de
  // property_cl se calculan al agrupar, pero dar de BAJA (markDelisted del
  // discovery) o REACTIVAR un anuncio ocurre FUERA del dedup y no los tocaba.
  // Resultado: 780 fichas marcadas inactivas con solo 179 anuncios inactivos —
  // 780 propiedades vivas invisibles en /chile/propiedades, que filtra por
  // is_active. La reconciliación tiene que correr en cada pasada del job.
  const orden = [];
  const paso = (nombre, valor) => async () => { orden.push(nombre); return valor; };

  const res = await handleDedupClusterJob({}, {
    nivel1: paso('nivel1', { groups_processed: 0, created: 0, linked: 0 }),
    link15: paso('link15', { linked: 0 }),
    broker: paso('broker', { advertisers_processed: 0, created: 0, linked: 0 }),
    reconcile: paso('reconcile', { reconciled: 780 }),
  });

  assert.deepEqual(res.reconcile, { reconciled: 780 });
  assert.ok(orden.includes('reconcile'), 'la reconciliación debe ejecutarse');
  // Va AL FINAL: el resto del pipeline mueve anuncios entre fichas antes.
  assert.equal(orden[orden.length - 1], 'reconcile');
  // Y el clustering difuso sigue desactivado (regla del usuario: dedup SOLO por
  // corredora + código interno).
  assert.ok(res.nivel2.skipped, 'nivel2 debe seguir desactivado por defecto');
});
