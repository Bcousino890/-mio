// Tests de consolidateFields · portal_first_seen_at (dedup-cl.mjs).
//
// Correr:  node --test scraper/lib/dedup-cl-portal-first-seen.test.mjs
//
// property_cl.portal_first_seen_at = antigüedad REAL del inmueble en el
// mercado (el MÍNIMO entre las corredoras que lo publican, ignorando nulls) —
// distinto de first_seen_at (cuándo NOSOTROS lo vimos). Ver 0076 y el bug real
// que lo motivó: "días en mercado" mostraba 0 pese a que el portal declaraba
// "Publicado hace 28 días", porque solo se usaba first_seen_at.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _internal } from './dedup-cl.mjs';

const { consolidateFields } = _internal;

const BASE = {
  operation: 'sale', property_type: 'casa', price: 500000000, price_uf: null, uf_rate: null, uf_rate_date: null,
  square_meters: 100, bedrooms: 3, bathrooms: 2, comuna_id: 'c1', localidad: null, latitude: -33.4, longitude: -70.5,
  location_confidence: 'none', exact_address: null, portal: 'portalinmobiliario', source_type: 'portal',
  advertiser_type: 'professional', advertiser_id: 'a1', is_active: true,
  first_seen_at: '2026-07-20', last_seen_at: '2026-07-24',
};

test('portal_first_seen_at: toma el MÍNIMO entre corredoras (la primera que lo publicó)', () => {
  const rows = [
    { ...BASE, advertiser_id: 'a1', portal_first_seen_at: new Date('2026-06-01') }, // la más antigua
    { ...BASE, advertiser_id: 'a2', portal_first_seen_at: new Date('2026-07-15') },
  ];
  const c = consolidateFields(rows);
  assert.equal(c.portal_first_seen_at.getTime(), new Date('2026-06-01').getTime());
});

test('portal_first_seen_at: ignora nulls (una corredora sin subtitle parseable no arruina el mínimo)', () => {
  const rows = [
    { ...BASE, advertiser_id: 'a1', portal_first_seen_at: null },
    { ...BASE, advertiser_id: 'a2', portal_first_seen_at: new Date('2026-06-10') },
  ];
  const c = consolidateFields(rows);
  assert.equal(c.portal_first_seen_at.getTime(), new Date('2026-06-10').getTime());
});

test('portal_first_seen_at: null si NINGÚN listing del grupo lo tiene', () => {
  const rows = [
    { ...BASE, advertiser_id: 'a1', portal_first_seen_at: null },
    { ...BASE, advertiser_id: 'a2', portal_first_seen_at: null },
  ];
  const c = consolidateFields(rows);
  assert.equal(c.portal_first_seen_at, null);
});
