// ─────────────────────────────────────────────────────────────────────────────
// Scorer dedicado de PAR de anuncios chilenos (plan Anuncios CL · Fase 3, H3).
//
// El feeder de Nivel 2 necesita puntuar cada par candidato (listing_match_cl):
// ¿son el MISMO inmueble físico? A diferencia de identity-resolution-cl.mjs —que
// resuelve la identidad de UN anuncio mezclando señales "solo suyas" (parcela,
// geocode, firma aérea)— aquí se usan EXCLUSIVAMENTE señales SIMÉTRICAS entre los
// dos anuncios. Que la parcela de A resuelva limpio no evidencia que B sea el
// mismo inmueble; incluir esas señales solo-de-A inflaría el score del par y
// sesgaría a falsos positivos (justo lo que el plan quiere evitar: "un umbral mal
// puesto contamina el dataset").
//
// Dos grupos de señales:
//   1. COMPATIBILIDAD DE HUELLA (guardarraíl, penaliza discrepancias): distancia,
//      m², dormitorios/baños, precio, tipo, operación. Se calcula reutilizando
//      matching.mjs (calculateMatchScore) con pesos CHILENOS (más laxos en m²/precio
//      porque entre corredoras esos datos son inconsistentes — ver
//      group-candidates-cl.mjs). Establece si "podrían" ser el mismo inmueble.
//   2. EVIDENCIA POSITIVA DE IDENTIDAD (señales duras chilenas, sumadas al raw):
//      mismo teléfono, misma corredora, MISMA foto reutilizada (pHash Hamming ≤
//      umbral) y dirección coincidente (trigramas). Estas son las que empujan un
//      par a "confirmado". Su AUSENCIA no penaliza: dos corredoras distintas
//      publicando el mismo inmueble casi nunca comparten foto/teléfono — por eso
//      un par con huella compatible pero SIN señal dura cae en la zona de
//      revisión manual (0.45–0.75), no en rechazo ni en confirmación automática.
//
// Umbrales (CL_IDENTITY_THRESHOLDS, ya calibrados en el plan): ≥0.75 confirmado
// (auto → alimenta el clustering), 0.45–0.75 candidato (cola de revisión humana),
// <0.45 se descarta (no se inserta fila, para no llenar de ruido listing_match_cl).
// ─────────────────────────────────────────────────────────────────────────────

import { calculateMatchScore } from './matching.mjs';
import { hammingDistance } from './phash.mjs';
import { CL_IDENTITY_THRESHOLDS } from './identity-resolution-cl.mjs';

// Pesos chilenos para la huella (grupo 1). Más laxos que España en m²/precio
// (inconsistentes entre corredoras) y con la dirección (text_similarity) como
// señal fuerte. NO se pasa phash aquí: en Chile el pHash es evidencia POSITIVA
// de foto reutilizada (grupo 2), no una penalización por diferencia.
export const CL_PAIR_WEIGHTS = {
  distance_m: -0.25, // guardarraíl geográfico (pin poco fiable, pero >150m ⇒ probablemente otro inmueble)
  sqm_diff_pct: -0.06, // laxo: m² declarado varía entre corredoras
  bedrooms_same: 0.15,
  bathrooms_diff: -0.04,
  price_diff_pct: -0.06, // laxo: misma propiedad se publica a distinto precio
  text_similarity: 0.20, // dirección coincidente: señal fuerte cuando ambas la traen
  property_type_same: 0.10,
  operation_same: 0.10,
};

// Bonos de identidad dura (grupo 2), sumados al raw antes del sigmoid.
export const CL_HARD_SIGNALS = {
  same_phone: 0.60, // mismo contacto ⇒ casi seguro mismo inmueble/corredora
  same_agency: 0.35, // misma corredora (re-publicación que Nivel 1 no cazó)
  photos_match: 0.50, // MISMA foto reutilizada (pHash Hamming ≤ umbral)
};

// Hamming ≤ este umbral (de 64 bits) ⇒ "misma foto" (recompresión/recorte leve).
export const PHASH_MATCH_THRESHOLD = 8;

// Mismo sigmoid que matching.mjs (factor 2) para mantener la misma escala de score.
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x * 2));
}

function normPhone(phone) {
  if (!phone) return null;
  const d = String(phone).replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-9) : null; // últimos 9 dígitos (ignora prefijo país)
}

function normAgency(name) {
  if (!name) return null;
  const s = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return s.length >= 3 ? s : null;
}

const EARTH_R = 6371000;
function haversine(a, b) {
  if (![a?.latitude, a?.longitude, b?.latitude, b?.longitude].every((v) => Number.isFinite(Number(v)))) return null;
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const la1 = toRad(a.latitude), la2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Trigramas (con padding) de un texto normalizado, para similitud de dirección. */
function trigrams(text) {
  const s = String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (s.length < 2) return new Set();
  const padded = `  ${s} `;
  const out = new Set();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Similitud Jaccard de trigramas (0..1), equivalente en JS a pg_trgm.similarity. */
export function addressSimilarity(addrA, addrB) {
  const A = trigrams(addrA), B = trigrams(addrB);
  if (A.size === 0 || B.size === 0) return null;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Menor Hamming entre cualquier par de pHash de A y B (incluye cover). null si falta info. */
export function minPhashHamming(a, b) {
  const hashesA = [a?.cover_phash, ...(a?.photo_phashes ?? [])].filter(Boolean);
  const hashesB = [b?.cover_phash, ...(b?.photo_phashes ?? [])].filter(Boolean);
  if (hashesA.length === 0 || hashesB.length === 0) return null;
  let min = Infinity;
  for (const ha of hashesA) {
    for (const hb of hashesB) {
      const d = hammingDistance(ha, hb);
      if (Number.isFinite(d) && d < min) min = d;
    }
  }
  return Number.isFinite(min) ? min : null;
}

/**
 * Construye las señales SIMÉTRICAS de un par. Puro y exportado para test.
 * @returns {{ footprint: object, hard: {same_phone:boolean, same_agency:boolean, photos_match:boolean}, phash_min:number|null }}
 */
export function buildPairSignals(a, b) {
  const distance_m = haversine(a, b);

  const sqmA = Number(a?.square_meters), sqmB = Number(b?.square_meters);
  const sqm_diff_pct = Number.isFinite(sqmA) && Number.isFinite(sqmB) && Math.max(sqmA, sqmB) > 0
    ? (Math.abs(sqmA - sqmB) / Math.max(sqmA, sqmB)) * 100 : null;

  const bedrooms_same = a?.bedrooms != null && b?.bedrooms != null ? a.bedrooms === b.bedrooms : null;
  const bathrooms_diff = a?.bathrooms != null && b?.bathrooms != null ? Math.abs(a.bathrooms - b.bathrooms) : null;

  const priceA = Number(a?.price), priceB = Number(b?.price);
  const price_diff_pct = Number.isFinite(priceA) && Number.isFinite(priceB) && Math.max(priceA, priceB) > 0
    ? (Math.abs(priceA - priceB) / Math.max(priceA, priceB)) * 100 : null;

  const property_type_same = a?.property_type && b?.property_type ? a.property_type === b.property_type : null;
  const operation_same = a?.operation && b?.operation ? a.operation === b.operation : null;

  const text_similarity = addressSimilarity(a?.address ?? a?.exact_address, b?.address ?? b?.exact_address);

  const phone_a = normPhone(a?.phone), phone_b = normPhone(b?.phone);
  const agency_a = normAgency(a?.advertiser_name), agency_b = normAgency(b?.advertiser_name);
  const phash_min = minPhashHamming(a, b);

  return {
    footprint: {
      distance_m, sqm_diff_pct, bedrooms_same, bathrooms_diff,
      price_diff_pct, text_similarity, property_type_same, operation_same,
    },
    hard: {
      same_phone: Boolean(phone_a && phone_b && phone_a === phone_b),
      same_agency: Boolean(agency_a && agency_b && agency_a === agency_b),
      photos_match: phash_min != null && phash_min <= PHASH_MATCH_THRESHOLD,
    },
    phash_min,
  };
}

/**
 * Puntúa un par de anuncios (0..1) y decide su status. Puro.
 *
 * @param {object} a - fila listings_cl (o subset con las columnas de señal)
 * @param {object} b - fila listings_cl
 * @param {object} [opts] - { weights, hard, thresholds }
 * @returns {{ score:number, status:'confirmed'|'candidate'|'rejected', signals:object, components:object, explanation:string }}
 */
export function scorePairCl(a, b, opts = {}) {
  const weights = opts.weights ?? CL_PAIR_WEIGHTS;
  const hardWeights = opts.hard ?? CL_HARD_SIGNALS;
  const thresholds = opts.thresholds ?? CL_IDENTITY_THRESHOLDS;

  const sig = buildPairSignals(a, b);

  // Grupo 1: huella, vía matching.mjs (reutiliza su normalización por señal).
  const base = calculateMatchScore(sig.footprint, weights);
  let raw = base.rawScore;
  const components = { ...base.components };

  // Grupo 2: bonos de identidad dura (solo suman; su ausencia no penaliza).
  for (const [name, present] of Object.entries(sig.hard)) {
    if (present) {
      const w = hardWeights[name] ?? 0;
      components[name] = w;
      raw += w;
    }
  }

  const score = sigmoid(raw);
  const status = score >= thresholds.confirmed ? 'confirmed'
    : score >= thresholds.candidate ? 'candidate'
    : 'rejected';

  const top = Object.entries(components).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 3)
    .map(([k, v]) => `${v >= 0 ? '+' : ''}${k}(${v.toFixed(2)})`).join(' ');

  return {
    score,
    status,
    signals: { ...sig.footprint, ...sig.hard, phash_min: sig.phash_min },
    components,
    explanation: `score=${score.toFixed(3)} [${status}] ${top}`,
  };
}
