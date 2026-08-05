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

/**
 * Resuelve QUÉ VALOR acaba de verdad en cada columna del INSERT: empareja la
 * lista de columnas con la de VALUES y sustituye cada $N por params[N-1].
 *
 * Contar placeholders (el test de arriba) NO basta y por eso este bug vivió
 * cinco días en producción: al añadir price_usd/usd_rate/usd_rate_date EN MEDIO
 * de la lista de columnas, el total siguió cuadrando mientras 19 columnas
 * pasaban a recibir el valor de la de al lado. Postgres solo se quejó de las que
 * además cambiaban de tipo — `invalid input syntax for type numeric:
 * "2026-08-05"`, que era usd_rate recibiendo uf_rate_date— y las demás se
 * guardaron mal en silencio.
 */
function valoresPorColumna(sqlCrudo, params) {
  // Fuera los comentarios SQL: el INSERT lleva varios, y sus comas partirían la
  // lista de columnas en trozos que no son columnas.
  const sql = sqlCrudo.replace(/--[^\n]*/g, '');
  const cuerpo = sql.slice(sql.indexOf('INSERT INTO listings_cl ('));
  const columnas = cuerpo.slice(cuerpo.indexOf('(') + 1, cuerpo.indexOf(') VALUES'))
    .split(',').map((c) => c.trim()).filter(Boolean);
  const tras = cuerpo.slice(cuerpo.indexOf(') VALUES') + ') VALUES'.length);
  const valores = tras.slice(tras.indexOf('(') + 1, tras.indexOf(')\n'))
    .split(',').map((v) => v.trim()).filter(Boolean);
  assert.equal(columnas.length, valores.length, 'el INSERT tiene distinto nº de columnas que de valores');
  const mapa = new Map();
  columnas.forEach((col, i) => {
    const v = valores[i];
    mapa.set(col, v.startsWith('$') ? params[Number(v.slice(1)) - 1] : v);
  });
  return mapa;
}

test('cada columna del INSERT recibe SU valor, no el de la de al lado', async () => {
  const client = makeClient();
  await upsertListingCl(client, {
    ...BASE_PARSED,
    price: 5000, currency: 'UF',              // fuerza conversión → uf_rate + uf_rate_date
    photos: ['https://foto/1.jpg'], photos_total_count: 12,
    has_video: true, video_modal_url: 'https://vm/x', advertiser_logo: 'https://logo/x.png',
    parser_version: 7,
  }, { ufRate: 39000, ufRateDate: '2026-08-05', scrapedAt: new Date('2026-08-05T22:00:00Z') });

  const v = valoresPorColumna(client.inserted.sql, client.inserted.params);

  // El descuadre exacto que reventaba en producción: una FECHA en una columna
  // numérica. uf_rate_date es la fecha; usd_rate es numeric y no la lleva.
  assert.equal(v.get('uf_rate_date'), '2026-08-05');
  assert.equal(v.get('uf_rate'), 39000);
  assert.notEqual(v.get('usd_rate'), '2026-08-05');

  // Y el resto de la zona que se había corrido entera.
  assert.equal(v.get('external_id'), 'MLC-1');
  assert.equal(v.get('currency'), 'UF');
  assert.equal(v.get('bedrooms'), 3);
  assert.equal(v.get('bathrooms'), 2);
  assert.equal(v.get('square_meters'), 100);
  assert.equal(v.get('property_type'), 'casa');
  assert.equal(v.get('address'), 'Av X 123');
  assert.equal(v.get('latitude'), -33.4);
  assert.equal(v.get('longitude'), -70.5);
  assert.equal(v.get('description'), 'desc');
  assert.equal(v.get('photos'), JSON.stringify(['https://foto/1.jpg']));
  assert.equal(v.get('photos_total_count'), 12);
  assert.equal(v.get('advertiser_logo'), 'https://logo/x.png');
  assert.equal(v.get('parser_version'), 7);
});

test('ninguna columna numérica del INSERT recibe algo que Postgres no acepte como número', async () => {
  // Guardia genérica: aunque alguien reordene y los nombres de arriba dejen de
  // cuadrar, una fecha o un JSON metidos en una columna numeric se cazan aquí en
  // el test y no con la cola de fichas atascada.
  const NUMERICAS = ['price', 'price_uf', 'price_usd', 'usd_rate', 'uf_rate',
    'latitude', 'longitude', 'bedrooms', 'bathrooms', 'square_meters', 'photos_total_count', 'parser_version'];
  const client = makeClient();
  await upsertListingCl(client, { ...BASE_PARSED, price: 5000, currency: 'UF', photos_total_count: 9 },
    { ufRate: 39000, ufRateDate: '2026-08-05', usdRate: 950, usdRateDate: '2026-08-05' });

  const v = valoresPorColumna(client.inserted.sql, client.inserted.params);
  for (const col of NUMERICAS) {
    const valor = v.get(col);
    if (valor == null) continue;
    assert.ok(
      typeof valor === 'number',
      `la columna numérica ${col} recibe ${JSON.stringify(valor)}, que no es un número`
    );
  }
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
  // Por posición absoluta ($N), no contando desde el final: añadir un campo
  // nuevo al INSERT desplazaba el final y rompía este test sin que nada
  // estuviera mal de verdad.
  const col = valoresPorColumna(client.inserted.sql, client.inserted.params);
  assert.equal(col.get('has_video'), false);
  assert.equal(col.get('video_modal_url'), null);
  assert.equal(col.get('advertiser_logo'), null);
  assert.equal(col.get('portal_first_seen_at'), null);
});

test('photos_total_count (el total que declara el portal) se persiste', async () => {
  // Sin este número no se puede saber si a una ficha le faltan fotos: 3 fotos
  // guardadas es correcto si el aviso tiene 3, y un fallo si tiene 24.
  const client = makeClient();
  await upsertListingCl(client, { ...BASE_PARSED, photos: ['a', 'b', 'c'], photos_total_count: 24 });
  assert.match(client.inserted.sql, /photos_total_count/);
  assert.equal(valoresPorColumna(client.inserted.sql, client.inserted.params).get('photos_total_count'), 24);
  // Y al refrescar no se pisa con null un total que ya se conocía.
  assert.match(client.inserted.sql, /photos_total_count = COALESCE\(EXCLUDED\.photos_total_count, listings_cl\.photos_total_count\)/);
});

test('advertiser_logo se persiste en el INSERT', async () => {
  const client = makeClient();
  await upsertListingCl(client, { ...BASE_PARSED, advertiser_logo: 'https://http2.mlstatic.com/storage/vis-accounts/234292543_vip-x.jpg' });
  assert.match(client.inserted.sql, /advertiser_logo/);
  assert.ok(client.inserted.params.includes('https://http2.mlstatic.com/storage/vis-accounts/234292543_vip-x.jpg'));
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

// ─── Cambio de precio: solo el PUBLICADO cuenta ──────────────────────────────
// Blinda el bug de producción: `price` (CLP) de un anuncio en UF es un valor
// DERIVADO (price_uf × la tasa UF del día). Como la UF sube casi a diario,
// comparar CLP marcaba "cambio de precio" en TODOS los anuncios en UF en cada
// refresco, sin que el vendedor tocara nada: 1.979 cambios en 24h, la inmensa
// mayoría falsos, ahogando las rebajas reales que es justo lo que se quiere ver.

const UF_PARSED = { ...BASE_PARSED, price: 14000, currency: 'UF' };

test('anuncio en UF: subir la tasa UF NO es un cambio de precio', async () => {
  // Mismo precio publicado (14.000 UF), tasa de ayer 40.000 → hoy 40.844,79.
  const client = makeClient({
    existing: {
      id: 'listing-1', price: 560_000_000, price_uf: 14000, currency: 'UF',
      advertiser_name: 'Test Corredora', photos: ['a', 'b'], description: 'desc',
      square_meters: 100, bedrooms: 3, bathrooms: 2, status: 'active', is_active: true, has_video: false,
    },
  });
  const { changeType } = await upsertListingCl(client, UF_PARSED, { ufRate: 40844.79, ufRateDate: '2026-07-28' });
  assert.equal(changeType, null, 'la UF del día no puede inventar un cambio de precio');
  assert.equal(client.versionLog.length, 0, 'ni escribir una fila en el histórico');
});

test('anuncio en UF: una rebaja REAL en UF sí se registra', async () => {
  const client = makeClient({
    existing: {
      id: 'listing-1', price: 571_827_060, price_uf: 14000, currency: 'UF',
      advertiser_name: 'Test Corredora', photos: ['a', 'b'], description: 'desc',
      square_meters: 100, bedrooms: 3, bathrooms: 2, status: 'active', is_active: true, has_video: false,
    },
  });
  const { changeType } = await upsertListingCl(
    client, { ...UF_PARSED, price: 13000 }, { ufRate: 40844.79, ufRateDate: '2026-07-28' },
  );
  assert.equal(changeType, 'price_change');
});

test('anuncio en CLP: el cambio se detecta sobre el CLP publicado', async () => {
  const client = makeClient({
    existing: {
      id: 'listing-1', price: 500_000_000, price_uf: null, currency: 'CLP',
      advertiser_name: 'Test Corredora', photos: ['a', 'b'], description: 'desc',
      square_meters: 100, bedrooms: 3, bathrooms: 2, status: 'active', is_active: true, has_video: false,
    },
  });
  const { changeType } = await upsertListingCl(client, { ...BASE_PARSED, price: 480_000_000 });
  assert.equal(changeType, 'price_change');
});

test('anuncio en UF sin price_uf previo (fila vieja) → no se inventa un cambio', async () => {
  const client = makeClient({
    existing: {
      id: 'listing-1', price: 560_000_000, price_uf: null, currency: 'UF',
      advertiser_name: 'Test Corredora', photos: ['a', 'b'], description: 'desc',
      square_meters: 100, bedrooms: 3, bathrooms: 2, status: 'active', is_active: true, has_video: false,
    },
  });
  const { changeType } = await upsertListingCl(client, UF_PARSED, { ufRate: 40844.79, ufRateDate: '2026-07-28' });
  assert.equal(changeType, null);
});

// ─── moneda no soportada ─────────────────────────────────────────────────────

test('anuncio en una moneda que el esquema no acepta → se guarda igual, sin precio inventado', async () => {
  // Regresión de producción. El parser copia `currency_id` del blob de Mercado
  // Libre tal cual cuando no es "CLF" (= UF), así que un anuncio publicado en
  // otra moneda llegaba al INSERT con un código que el CHECK de 0028 rechaza:
  // la ficha NO se guardaba nunca y su job volvía a fallar en cada pasada.
  // Visto en el panel de salud: 4 fichas con
  // 'new row for relation "listings_cl" violates check constraint'.
  // El ejemplo era USD, pero desde que se cableó su tasa (usd-rate-cl.mjs) esa
  // moneda SÍ se soporta. El caso sigue vivo con cualquier otra: el parser copia
  // `currency_id` de Mercado Libre tal cual, así que basta con que el portal
  // publique en euros para volver a la situación original.
  const client = makeClient();
  await upsertListingCl(client, { ...BASE_PARSED, price: 450_000, currency: 'EUR' });

  const sql = client.inserted.sql;
  const param = (n) => valoresPorColumna(client.inserted.sql, client.inserted.params).get(n);
  // La moneda que llega a la base es una de las dos que el CHECK permite.
  assert.ok(['CLP', 'UF', 'USD'].includes(param('currency')));
  // Y el importe NO se copia: 450.000 euros no son 450.000 pesos.
  assert.equal(param('price'), null);
  assert.equal(param('price_uf'), null);
  // Pero la ficha entra: es lo que se estaba perdiendo entera.
  assert.match(sql, /INSERT INTO listings_cl/);
  assert.ok(client.inserted.params.includes('Test Corredora'));
});

test('CLP y UF siguen pasando intactas', async () => {
  const clp = makeClient();
  await upsertListingCl(clp, { ...BASE_PARSED, price: 500_000_000, currency: 'CLP' });
  const vClp = valoresPorColumna(clp.inserted.sql, clp.inserted.params);
  assert.equal(vClp.get('currency'), 'CLP');
  assert.equal(vClp.get('price'), 500_000_000);

  const uf = makeClient();
  await upsertListingCl(uf, { ...BASE_PARSED, price: 12_000, currency: 'UF' }, { ufRate: 40_000, ufRateDate: '2026-07-30' });
  const vUf = valoresPorColumna(uf.inserted.sql, uf.inserted.params);
  assert.equal(vUf.get('currency'), 'UF');
  assert.equal(vUf.get('price_uf'), 12_000);
  assert.equal(vUf.get('price'), 480_000_000); // 12.000 × 40.000
});

// ─── una respuesta parcial del portal no puede borrar fotos ──────────────────

test('un re-scrapeo que trae MENOS fotos no pisa las que ya había', async () => {
  // Verificado en vivo sobre MLC-4014327318: teníamos 14 fotos guardadas y tres
  // peticiones seguidas al modal de galería devolvieron 9. No es un error: es
  // un 200 con menos fotos. Con `photos = EXCLUDED.photos` sin condiciones, el
  // siguiente re-scrapeo habría dejado la ficha en 9 para siempre — y con la
  // rotación pasando por todo el catálogo, le tocaría a cualquiera.
  const guardadas = Array.from({ length: 14 }, (_, i) => `https://http2.mlstatic.com/D_NQ_NP_00001${i}-MLC90000${i}-F.webp`);
  const client = makeClient({
    existing: {
      id: 'listing-1', price: 500_000_000, price_uf: null, currency: 'CLP',
      advertiser_name: 'Test Corredora', photos: guardadas, description: 'desc',
      square_meters: 100, bedrooms: 3, bathrooms: 2, status: 'active', is_active: true, has_video: false,
    },
  });
  const parciales = guardadas.slice(0, 9);
  const { changeType } = await upsertListingCl(client, { ...BASE_PARSED, photos: parciales, photos_total_count: 29 });

  assert.equal(JSON.parse(valoresPorColumna(client.inserted.sql, client.inserted.params).get('photos')).length, 14); // $25 = photos
  assert.notEqual(changeType, 'updated'); // tampoco se registra un cambio que no hubo
});

test('si el vendedor borra fotos de verdad, el set nuevo SÍ entra', async () => {
  // El portal declara ahora 2 y el scrapeo trae 2: encoge, pero está completo.
  // Quedarse con las 5 viejas sería conservar URLs muertas.
  const guardadas = Array.from({ length: 5 }, (_, i) => `https://http2.mlstatic.com/D_NQ_NP_00002${i}-MLC91000${i}-F.webp`);
  const client = makeClient({
    existing: {
      id: 'listing-1', price: 500_000_000, price_uf: null, currency: 'CLP',
      advertiser_name: 'Test Corredora', photos: guardadas, description: 'desc',
      square_meters: 100, bedrooms: 3, bathrooms: 2, status: 'active', is_active: true, has_video: false,
    },
  });
  await upsertListingCl(client, { ...BASE_PARSED, photos: guardadas.slice(0, 2), photos_total_count: 2 });
  assert.equal(JSON.parse(valoresPorColumna(client.inserted.sql, client.inserted.params).get('photos')).length, 2);
});

test('una ficha nueva guarda lo que traiga, sin nada con qué comparar', async () => {
  const client = makeClient();
  await upsertListingCl(client, { ...BASE_PARSED, photos: ['a', 'b', 'c'], photos_total_count: 3 });
  assert.equal(JSON.parse(valoresPorColumna(client.inserted.sql, client.inserted.params).get('photos')).length, 3);
});

// ─── anuncios publicados en dólares ──────────────────────────────────────────

test('anuncio en USD: se guarda el importe publicado y el CLP convertido con la tasa', async () => {
  // Antes estos anuncios no se guardaban (el CHECK de currency los rechazaba) y
  // luego se guardaban sin precio, porque copiar 450.000 dólares como 450.000
  // pesos habría envenenado el precio/m² y los filtros.
  const client = makeClient();
  await upsertListingCl(client, { ...BASE_PARSED, price: 450_000, currency: 'USD' },
    { usdRate: 950, usdRateDate: '2026-07-31' });

  const param = (n) => valoresPorColumna(client.inserted.sql, client.inserted.params).get(n);
  assert.equal(param('currency'), 'USD');          // la moneda publicada se conserva
  assert.equal(param('price_usd'), 450_000);       // importe publicado
  assert.equal(param('price'), 427_500_000);       // CLP = 450.000 × 950
  assert.equal(param('usd_rate'), 950);            // tasa usada
  assert.equal(param('usd_rate_date'), '2026-07-31'); // y su fecha, para auditarlo
});

test('anuncio en USD sin tasa disponible: se guarda sin precio, nunca con uno falso', async () => {
  const client = makeClient();
  await upsertListingCl(client, { ...BASE_PARSED, price: 450_000, currency: 'USD' });
  const sinTasa = valoresPorColumna(client.inserted.sql, client.inserted.params);
  assert.equal(sinTasa.get('price'), null);
  assert.equal(sinTasa.get('price_usd'), 450_000); // el importe publicado sí se conserva
});

test('anuncio en USD: mover el tipo de cambio NO es un cambio de precio', async () => {
  // Mismo caso que la UF: price (CLP) es derivado, así que compararlo marcaría
  // una rebaja falsa cada vez que se mueve el dólar.
  const client = makeClient({
    existing: {
      id: 'listing-1', price: 427_500_000, price_uf: null, price_usd: 450_000, currency: 'USD',
      advertiser_name: 'Test Corredora', photos: ['a', 'b'], description: 'desc',
      square_meters: 100, bedrooms: 3, bathrooms: 2, status: 'active', is_active: true, has_video: false,
    },
  });
  const { changeType } = await upsertListingCl(client, { ...BASE_PARSED, price: 450_000, currency: 'USD' },
    { usdRate: 980, usdRateDate: '2026-08-01' });
  assert.equal(changeType, null);
});

test('anuncio en USD: una rebaja de verdad SÍ se detecta', async () => {
  const client = makeClient({
    existing: {
      id: 'listing-1', price: 427_500_000, price_uf: null, price_usd: 450_000, currency: 'USD',
      advertiser_name: 'Test Corredora', photos: ['a', 'b'], description: 'desc',
      square_meters: 100, bedrooms: 3, bathrooms: 2, status: 'active', is_active: true, has_video: false,
    },
  });
  const { changeType } = await upsertListingCl(client, { ...BASE_PARSED, price: 420_000, currency: 'USD' },
    { usdRate: 950, usdRateDate: '2026-07-31' });
  assert.equal(changeType, 'price_change');
});
