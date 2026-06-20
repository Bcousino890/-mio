// ─────────────────────────────────────────────────────────────────────────────
// Agrupamiento de candidatos a "misma propiedad física" para Chile, previo a
// llamar identity-resolution-cl.mjs.
//
// POR QUÉ ESTE ARCHIVO EXISTE (y por qué NO reutiliza find_match_candidates()
// de db/migrations/0008_dedup_matching.sql, el blocking de España):
//
// En España, un mismo piso publicado en Idealista y Fotocasa trae casi
// siempre los mismos m²/dormitorios exactos y muchas veces las mismas fotos
// (el propietario/agencia sube el mismo material a ambos portales). Por eso
// el blocking español puede permitirse ser estricto: mismo nº de dormitorios
// EXACTO + m² dentro de ±8%.
//
// En Chile el problema es distinto: una misma propiedad se publica a través
// de 10+ corredoras distintas en simultáneo (venta Y arriendo a la vez,
// frecuentemente), cada una con:
//   - Fotos diferentes (sesiones profesionales distintas, "más bonitas" según
//     el usuario) → el pHash casi nunca va a coincidir entre corredoras.
//   - m²/dormitorios/baños declarados de forma inconsistente (errores,
//     redondeos, o exageración comercial) → un filtro de ±8% de m² puede
//     excluir candidatos que SÍ son la misma propiedad.
//   - Pines de mapa potencially distintos y cada uno potencialmente
//     impreciso (no solo el de una corredora descuidada).
//
// Si aplicáramos el blocking español tal cual, perderíamos la señal más
// fuerte y barata que tenemos (estrategia #1 del research,
// docs/research-portalinmobiliario-chile.md): la triangulación entre
// anuncios. Por eso este blocking es deliberadamente MÁS LAXO en atributos
// (no exige dormitorios exactos ni m² ajustado) y se apoya en señales que sí
// son estables entre republicaciones de corredoras distintas: comuna,
// operación, banda de precio amplia y proximidad geográfica generosa. El
// descarte fino de falsos positivos queda para identity-resolution-cl.mjs
// (que SÍ pondera m²/dormitorios, pero como una señal más entre varias, no
// como un filtro binario de entrada).
// ─────────────────────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineMeters(a, b) {
  if (!a || !b) return null;
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) {
    return null;
  }
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function normalizeText(s) {
  return (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Default deliberadamente laxos — ver comentario de cabecera. NO incluyen
// tolerancia de dormitorios/m² porque esa comparación se delega al scoring
// fino, no al blocking.
const DEFAULT_OPTS = {
  radiusM: 350, // más amplio que los 150m de España: aquí el pin no es confiable
  priceBandPct: 30, // banda de precio amplia: una corredora "más cara" no debe excluirse
  requireSameOperation: false, // la misma propiedad suele publicarse en venta Y arriendo a la vez en Chile
  requireSameComuna: true,
};

/**
 * Agrupa `pool` (todos los listings normalizados de Chile, ej. de
 * toAppListingCl) en candidatos a ser la MISMA propiedad física que
 * `target`. No decide nada por sí mismo — solo reduce el universo de
 * comparación para alimentar `resolvePropertyIdentity({ listing: target,
 * candidateListings: <resultado de esta función> })`.
 *
 * @param {object} target - listing a resolver
 * @param {object[]} pool - todos los demás listings disponibles (mismo lote/comuna)
 * @param {object} [opts]
 * @returns {object[]} subconjunto de `pool` que pasa el blocking laxo
 */
export function groupCandidateListingsCl(target, pool = [], opts = {}) {
  if (!target || !Array.isArray(pool) || pool.length === 0) return [];

  const { radiusM, priceBandPct, requireSameOperation, requireSameComuna } = { ...DEFAULT_OPTS, ...opts };

  const targetComuna = normalizeText(target.comuna);
  const targetAddress = normalizeText(target.address);
  const hasTargetPoint = Number.isFinite(target.lat) && Number.isFinite(target.lng);

  return pool.filter((cand) => {
    if (!cand || cand === target) return false;
    if (cand.id != null && target.id != null && cand.id === target.id) return false;

    if (requireSameComuna && targetComuna) {
      const candComuna = normalizeText(cand.comuna);
      if (candComuna && candComuna !== targetComuna) return false;
    }

    if (requireSameOperation && target.operation && cand.operation && target.operation !== cand.operation) {
      return false;
    }

    // Señales "duras" que SÍ son estables entre corredoras distintas (no
    // dependen de cómo cada uno mide/fotografía la propiedad):
    const samePhone =
      target.phone && cand.phone && normalizeText(target.phone).replace(/\D/g, '') === normalizeText(cand.phone).replace(/\D/g, '');
    const sameAgency = target.agency_name && cand.agency_name && normalizeText(target.agency_name) === normalizeText(cand.agency_name);
    const sameAddressText = targetAddress && targetAddress.length > 4 && normalizeText(cand.address) === targetAddress;

    if (samePhone || sameAgency || sameAddressText) return true;

    // Si no hay ninguna señal dura, exigimos proximidad geográfica + precio
    // compatible (banda amplia, sin filtro de dormitorios/m²).
    if (!hasTargetPoint) return false;
    const dist = haversineMeters({ lat: target.lat, lng: target.lng }, { lat: cand.lat, lng: cand.lng });
    if (dist === null || dist > radiusM) return false;

    if (Number.isFinite(target.price) && Number.isFinite(cand.price) && target.price > 0) {
      const diffPct = (Math.abs(target.price - cand.price) / target.price) * 100;
      if (diffPct > priceBandPct) return false;
    }

    return true;
  });
}
