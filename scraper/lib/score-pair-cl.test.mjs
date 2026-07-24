// Tests del scorer dedicado de par (score-pair-cl.mjs · Fase 3, H3).
//
// Correr:  node --test scraper/lib/score-pair-cl.test.mjs
//
// Verifican la calibración que el plan exige: señal dura de identidad (mismo
// teléfono / misma foto) → confirmado; solo huella+geo → candidato (revisión
// humana); claramente distinto → rechazado. Y que las señales solo-de-un-lado
// NO se usan (el scorer es simétrico).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scorePairCl,
  buildPairSignals,
  addressSimilarity,
  minPhashHamming,
  PHASH_MATCH_THRESHOLD,
} from './score-pair-cl.mjs';

const BASE = {
  latitude: -33.40, longitude: -70.58, square_meters: 120, bedrooms: 3, bathrooms: 2,
  price: 500000000, property_type: 'casa', operation: 'sale', address: 'Av Apoquindo 1234, Las Condes',
};

// ── Helpers puros ────────────────────────────────────────────────────────────

test('addressSimilarity: variantes de la misma dirección son altas', () => {
  const s = addressSimilarity('Av Apoquindo 1234, Las Condes', 'Avenida Apoquindo 1234, Las Condes');
  assert.ok(s > 0.5, `esperaba >0.5, dio ${s}`);
  assert.equal(addressSimilarity('Apoquindo 1234', 'Otra Calle 999') < 0.3, true);
  assert.equal(addressSimilarity(null, 'x'), null);
});

test('minPhashHamming: misma foto (Hamming bajo) vs distinta', () => {
  assert.equal(minPhashHamming({ cover_phash: 'ffff0000ffff0000' }, { cover_phash: 'ffff0000ffff0000' }), 0);
  assert.ok(minPhashHamming({ cover_phash: 'ffff0000ffff0000' }, { cover_phash: 'ffff0000ffff0001' }) <= PHASH_MATCH_THRESHOLD);
  assert.equal(minPhashHamming({ photo_phashes: [] }, { cover_phash: 'ffff0000ffff0000' }), null);
});

test('buildPairSignals: señales simétricas correctas', () => {
  const sig = buildPairSignals(BASE, { ...BASE, phone: '111', advertiser_name: 'X' });
  assert.equal(sig.footprint.bedrooms_same, true);
  assert.equal(sig.footprint.property_type_same, true);
  assert.equal(sig.footprint.operation_same, true);
  assert.equal(sig.footprint.distance_m, 0);
  assert.equal(sig.hard.same_phone, false); // solo B tiene phone
});

// ── Calibración (el corazón del scorer) ──────────────────────────────────────

test('mismo teléfono (misma corredora re-list) → confirmed', () => {
  const r = scorePairCl({ ...BASE, phone: '+56 9 1111 1111' }, { ...BASE, phone: '569 11111111' });
  assert.equal(r.status, 'confirmed');
  assert.ok(r.score >= 0.75);
});

test('cross-corredora, solo huella + dirección → candidate (revisión)', () => {
  const r = scorePairCl(BASE, { ...BASE, price: 520000000, square_meters: 128, address: 'Avenida Apoquindo 1234, Las Condes' });
  assert.equal(r.status, 'candidate');
  assert.ok(r.score >= 0.45 && r.score < 0.75, `score ${r.score}`);
});

test('cross-corredora + MISMA foto reutilizada → confirmed', () => {
  const r = scorePairCl(
    { ...BASE, cover_phash: 'ffff0000ffff0000' },
    { ...BASE, price: 520000000, address: 'Apoquindo 1234', cover_phash: 'ffff0000ffff0001' }
  );
  assert.equal(r.status, 'confirmed');
});

test('vecino coincidente (otro inmueble) → rejected', () => {
  const r = scorePairCl(BASE, {
    latitude: -33.4012, longitude: -70.5815, square_meters: 200, bedrooms: 5, bathrooms: 4,
    price: 900000000, property_type: 'casa', operation: 'sale', address: 'Otra Calle 999',
  });
  assert.equal(r.status, 'rejected');
  assert.ok(r.score < 0.45);
});

test('la ausencia de señal dura NO penaliza (foto faltante ≠ evidencia en contra)', () => {
  // Dos anuncios idénticos en huella pero sin fotos ni teléfono: debe seguir
  // siendo al menos candidato, no rechazado por "no hay foto que coincida".
  const r = scorePairCl(BASE, { ...BASE, address: 'Av Apoquindo 1234, Las Condes' });
  assert.notEqual(r.status, 'rejected');
});

test('MISMA corredora + huella parecida pero SIN foto/teléfono/dirección → NO confirmed', () => {
  // Bug real: 5 casas DISTINTAS de "Home Hunters" (misma comuna, 4 dorm, 400 m²,
  // pin genérico, precios con 170% de diferencia) se fusionaban en un inmueble.
  // Sin evidencia dura de misma propiedad, jamás debe auto-confirmarse.
  const a = { latitude: -33.40, longitude: -70.58, square_meters: 400, bedrooms: 4, bathrooms: 3, price: 649432161, property_type: 'casa', operation: 'sale', address: null, advertiser_name: 'Home Hunters Asesoría Y Gestión Inmobiliaria' }
  const b = { ...a, price: 1756325970 } // otra casa, mismo formato, precio muy distinto
  const r = scorePairCl(a, b)
  assert.notEqual(r.status, 'confirmed')
})

test('MISMA corredora PERO con foto reutilizada (misma propiedad) → sí confirmed', () => {
  // El guardarraíl no debe romper el caso legítimo: si comparten foto, es la
  // misma propiedad aunque sea la misma corredora (re-publicación que Nivel 1 no cazó).
  const a = { latitude: -33.40, longitude: -70.58, square_meters: 400, bedrooms: 4, bathrooms: 3, price: 649432161, property_type: 'casa', operation: 'sale', address: null, advertiser_name: 'Home Hunters', cover_phash: 'ffff0000ffff0000' }
  const b = { ...a, price: 650000000, cover_phash: 'ffff0000ffff0001' }
  const r = scorePairCl(a, b)
  assert.equal(r.status, 'confirmed')
})

test('scorePairCl es simétrico: score(a,b) == score(b,a)', () => {
  const a = { ...BASE, phone: '569 22222222' };
  const b = { ...BASE, price: 490000000, square_meters: 118, address: 'Apoquindo 1234 Las Condes' };
  assert.equal(scorePairCl(a, b).score, scorePairCl(b, a).score);
});

test('mismo inmueble sin dirección pero coords ~30m → candidate', () => {
  const r = scorePairCl(
    { ...BASE, address: null },
    { latitude: -33.4002, longitude: -70.5801, square_meters: 125, bedrooms: 3, bathrooms: 2, price: 510000000, property_type: 'casa', operation: 'sale', address: null }
  );
  assert.equal(r.status, 'candidate');
});
