// ─────────────────────────────────────────────────────────────────────────────
// Feeder de listing_match_cl (plan Anuncios CL · Fase 3, H3).
//
// La pieza que faltaba entre el blocking + el scorer y el clustering Nivel 2:
// el runner que efectivamente PUEBLA listing_match_cl con pares puntuados. Sin
// esto, clustering-cl.mjs no tiene pares confirmados que consumir.
//
// Flujo por comuna (para acotar el O(n²) del blocking a un pool manejable):
//   1. Carga los anuncios ACTIVOS de la comuna.
//   2. Para cada anuncio, hace blocking laxo con group-candidates-cl.mjs
//      (comuna + operación + banda de precio/proximidad, señales duras).
//   3. Puntúa cada par UNA sola vez (ordenado a<b) con score-pair-cl.mjs.
//   4. Upsert en listing_match_cl con status/score/signals y decided_by='auto'.
//      NUNCA pisa una decisión HUMANA (decided_by='human') — esa es la cola de
//      revisión, la fuente de verdad para el score intermedio (0.45–0.75).
//   5. Los pares 'rejected' (<0.45) NO se insertan: mantienen la tabla limpia.
//
// Se saltan los pares que YA comparten property_cl (Nivel 1 los agrupó por
// property_code): re-confirmarlos sería redundante. El caso que importa aquí es
// el cross-corredora (property_cl distintos o aún sin agrupar), que es
// justamente lo que el clustering Nivel 2 luego fusiona.
//
// Idempotente: re-ejecutar re-puntúa (scores deterministas) y refresca las filas
// 'auto'; las 'human' quedan intactas.
// ─────────────────────────────────────────────────────────────────────────────

import { groupCandidateListingsCl } from './group-candidates-cl.mjs';
import { scorePairCl } from './score-pair-cl.mjs';

// Columnas necesarias para blocking + scoring (score-pair-cl lee de listings_cl).
const MATCH_FIELDS = `
  id, latitude, longitude, comuna_id, address, exact_address, phone, advertiser_name,
  price, price_uf, square_meters, bedrooms, bathrooms, property_type, operation,
  cover_phash, photo_phashes, property_cl_id
`;

/** Mapea una fila listings_cl al objeto que espera el blocking (group-candidates-cl). */
function toBlockingObj(row) {
  return {
    id: row.id,
    lat: row.latitude != null ? Number(row.latitude) : null,
    lng: row.longitude != null ? Number(row.longitude) : null,
    comuna: row.comuna_id,
    address: row.address ?? row.exact_address ?? null,
    phone: row.phone,
    agency_name: row.advertiser_name,
    price: row.price != null ? Number(row.price) : null,
    operation: row.operation,
  };
}

/** Upsert de un par (ordenado a<b) sin pisar decisiones humanas. */
async function upsertMatch(client, listingA, listingB, res) {
  await client.query(
    `INSERT INTO listing_match_cl (listing_a, listing_b, score, signals, status, decided_by, decided_at)
     VALUES ($1, $2, $3, $4, $5, 'auto', now())
     ON CONFLICT (listing_a, listing_b) DO UPDATE SET
       score = EXCLUDED.score,
       signals = EXCLUDED.signals,
       status = EXCLUDED.status,
       decided_at = now()
     WHERE listing_match_cl.decided_by = 'auto'`,
    [listingA, listingB, res.score, JSON.stringify({ ...res.signals, explanation: res.explanation }), res.status]
  );
}

/**
 * Puntúa y persiste los pares candidatos de UNA comuna.
 * @returns {{ listings:number, pairs_scored:number, confirmed:number, candidate:number, rejected:number, upserted:number }}
 */
export async function feedComuna(client, comunaId, deps = {}) {
  const { block = groupCandidateListingsCl, score = scorePairCl, upsert = upsertMatch } = deps;

  const { rows } = await client.query(
    `SELECT ${MATCH_FIELDS} FROM listings_cl WHERE is_active = true AND comuna_id = $1`,
    [comunaId]
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pool = rows.map(toBlockingObj);

  const stats = { listings: rows.length, pairs_scored: 0, confirmed: 0, candidate: 0, rejected: 0, upserted: 0 };
  const seenPairs = new Set();

  for (const target of pool) {
    const candidates = block(target, pool);
    for (const cand of candidates) {
      // Cada par no ordenado, una sola vez.
      const [a, b] = String(target.id) < String(cand.id) ? [target.id, cand.id] : [cand.id, target.id];
      const key = `${a}|${b}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);

      const rowA = byId.get(a);
      const rowB = byId.get(b);
      if (!rowA || !rowB) continue;
      // Ya agrupados por Nivel 1 (mismo property_code) → no re-confirmar.
      if (rowA.property_cl_id && rowA.property_cl_id === rowB.property_cl_id) continue;

      const res = score(rowA, rowB);
      stats.pairs_scored++;
      if (res.status === 'rejected') { stats.rejected++; continue; } // no se inserta ruido

      await upsert(client, a, b, res);
      stats[res.status]++;
      stats.upserted++;
    }
  }

  return stats;
}

/** Comunas con anuncios activos (para procesar por lotes cuando no se pasa una fija). */
async function activeComunas(client, limit) {
  const { rows } = await client.query(
    `SELECT DISTINCT comuna_id FROM listings_cl
     WHERE is_active = true AND comuna_id IS NOT NULL
     LIMIT $1`,
    [limit]
  );
  return rows.map((r) => r.comuna_id);
}

/**
 * Feeder completo: puntúa pares y puebla listing_match_cl para un conjunto de
 * comunas (o todas las que tengan anuncios activos, por lotes).
 *
 * @param {import('pg').Client} client
 * @param {{ comunaIds?: string[], maxComunas?: number }} [options]
 * @returns {Promise<{ comunas:number, listings:number, pairs_scored:number, confirmed:number, candidate:number, rejected:number, upserted:number }>}
 */
export async function runMatchFeederCl(client, options = {}) {
  const { comunaIds = null, maxComunas = 20, ...deps } = options;
  const comunas = comunaIds ?? (await activeComunas(client, maxComunas));

  const total = { comunas: 0, listings: 0, pairs_scored: 0, confirmed: 0, candidate: 0, rejected: 0, upserted: 0 };
  for (const comunaId of comunas) {
    const s = await feedComuna(client, comunaId, deps);
    total.comunas++;
    total.listings += s.listings;
    total.pairs_scored += s.pairs_scored;
    total.confirmed += s.confirmed;
    total.candidate += s.candidate;
    total.rejected += s.rejected;
    total.upserted += s.upserted;
  }
  return total;
}
