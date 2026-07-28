// Tests del "precio de mercado" de una ficha canónica (consolidateFields).
//
// Correr:  node --test scraper/lib/dedup-cl-canonical-price.test.mjs
//
// Blindan una regresión de la migración 0080 (listings_cl.price: integer →
// bigint). node-postgres devuelve bigint como STRING —int64 no cabe en un
// double—, así que el `b.price < a.price` que elegía el anuncio más barato
// pasó a comparar LEXICOGRÁFICAMENTE sin que nada fallara a la vista:
//
//     '9000000' < '10000000'  →  false   ('9' pesa más que '1')
//
// o sea que 10 millones se elegía como "más barato" que 9. El resultado va a
// property_cl.canonical_price, que es el precio que la UI muestra y por el que
// ordena — un error silencioso en todas las fichas con varios anuncios a
// distinto precio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _internal } from './dedup-cl.mjs';

const { consolidateFields } = _internal;

/** Fila tal como la devuelve pg: price (bigint) como STRING. */
function fila(price, extra = {}) {
  return {
    id: `l-${price}`, price: price == null ? null : String(price), price_uf: null,
    operation: 'sale', property_type: 'casa', portal: 'portalinmobiliario',
    source_type: 'portal', advertiser_type: 'professional', advertiser_id: 'a1',
    is_active: true, comuna_id: 'c1', localidad: null, square_meters: 100,
    bedrooms: 3, bathrooms: 2, last_seen_at: new Date('2026-07-28'),
    ...extra,
  };
}

test('canonical_price: el más barato se elige por valor numérico, no alfabético', () => {
  // El caso exacto que rompía: distinto número de dígitos.
  const c = consolidateFields([fila(10000000), fila(9000000)]);
  assert.equal(Number(c.canonical_price), 9000000);
});

test('canonical_price: el orden en que llegan los anuncios no cambia el resultado', () => {
  const barato = Number(consolidateFields([fila(9000000), fila(10000000)]).canonical_price);
  const alReves = Number(consolidateFields([fila(10000000), fila(9000000)]).canonical_price);
  assert.equal(barato, 9000000);
  assert.equal(alReves, 9000000);
});

test('canonical_price: con precios caros de varios dígitos sigue ganando el menor', () => {
  // 950 millones vs 1.200 millones: alfabéticamente '1200000000' < '950000000'.
  const c = consolidateFields([fila(1200000000), fila(950000000), fila(2246463450)]);
  assert.equal(Number(c.canonical_price), 950000000);
});

test('canonical_price: los anuncios sin precio no ganan ni tumban la elección', () => {
  const c = consolidateFields([fila(null), fila(9000000), fila(10000000)]);
  assert.equal(Number(c.canonical_price), 9000000);
});

test('canonical_price: manda el mínimo de los ACTIVOS, aunque haya uno inactivo más barato', () => {
  const c = consolidateFields([
    fila(9000000, { is_active: false }),
    fila(10000000),
    fila(12000000),
  ]);
  assert.equal(Number(c.canonical_price), 10000000);
});
