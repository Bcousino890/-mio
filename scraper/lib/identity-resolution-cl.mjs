// ─────────────────────────────────────────────────────────────────────────────
// Orquestador de resolución de identidad catastral para Chile
// (Portalinmobiliario / Mercado Libre Chile).
//
// Combina las 6 estrategias documentadas en
// docs/research-portalinmobiliario-chile.md, sección "Estrategias de
// resolución de identidad real de la propiedad":
//   1. Triangulación entre anuncios (teléfono/agencia, pHash, republicaciones).
//   2. Geocodificación de dirección declarada vs pin del anuncio.
//   3. Point-in-polygon catastral + detector de pin sospechoso.
//   4. Matching de huella física (m²/dormitorios/baños/tipo) vs metadata SII.
//   5. Fuentes complementarias (fuera de alcance de este módulo — se deja
//      como ampliación futura del parámetro `findParcelByPoint`).
//   6. Firma aérea (piscina + huella de construcción burda).
//
// IMPORTANTE — reutiliza `scraper/lib/matching.mjs` de forma READ-ONLY. No se
// modifica ese archivo ni su `DEFAULT_WEIGHTS`; este módulo define sus
// propios pesos (`CL_IDENTITY_WEIGHTS`) y los pasa explícitamente como
// segundo argumento a `calculateMatchScore`/`evaluateMatch`. `matching.mjs`
// es agnóstico de país e ignora cualquier `signalName` que no reconoce
// (`default: continue` en su switch) — por eso las señales nuevas específicas
// de Chile (pin sospechoso, triangulación, pool_match) NO pasan por
// `calculateMatchScore`: se combinan en este archivo con su propia lógica y
// solo la sub-señal de "huella física" (m²/dormitorios/tipo) reutiliza el
// motor compartido, porque sus signal names (`sqm_diff_pct`,
// `bedrooms_same`, `bathrooms_diff`, `property_type_same`) SÍ son los que
// `matching.mjs` ya sabe interpretar.
//
// CONTRATOS ESPERADOS DE DEPENDENCIAS INYECTADAS (sin importar nada de ellas
// directamente, porque otros dos agentes las están construyendo en paralelo
// y pueden no existir aún en disco):
//
// `findParcelByPoint(lat, lng) => parcela|null` — se espera que exponga
// `scraper/lib/cadastre-cl.mjs`. Contrato asumido para una parcela encontrada:
//   {
//     rol: string,            // "manzana-predio", ej. "2922-27"
//     rol_matriz: string|null,// rol matriz si la parcela tiene sub-rol (copropiedad)
//     rol_unidad: string|null,// sub-rol de la unidad si aplica
//     comuna_id: string|number,
//     geom: object|null,      // geometría de la parcela (GeoJSON o similar), opcional
//     centroid: {lat:number, lng:number}, // REQUERIDO por la estrategia #6
//     source: string,         // de qué fuente vino (IDE municipal, SII Mapas, etc.)
//   }
// Si `cadastre-cl.mjs` devuelve una forma distinta (ej. `geometry` en vez de
// `geom`, o sin `centroid` precalculado), este módulo necesitará un ajuste
// menor en `extractCentroid()` más abajo — está aislado a propósito para que
// ese ajuste sea de una sola función. SUPUESTO ABIERTO a validar con el
// agente que construye cadastre-cl.mjs.
//
// `listing` (anuncio a resolver) — se asume al menos:
//   {
//     lat: number|null, lng: number|null,
//     address: string|null, comuna: string|null,
//     sqm: number|null, bedrooms: number|null, bathrooms: number|null,
//     property_type: string|null,
//     phone: string|null, agency_name: string|null,
//     photo_phashes: string[]|null,  // puede venir vacío/null (phash.mjs deshabilitado hoy)
//   }
// Campos ausentes se degradan a "sin señal" (no se asume su presencia).
//
// `candidateListings` — array de otros anuncios ya scrapeados/normalizados
// con la misma forma que `listing`, candidatos a ser la MISMA propiedad
// física (ej. agrupados previamente por comuna+rango de precio/m² en una
// query SQL upstream — ese agrupamiento NO es responsabilidad de este
// archivo). Puede venir vacío.
// ─────────────────────────────────────────────────────────────────────────────

import { calculateMatchScore } from './matching.mjs';
import { geocodeAddressCl, distanceMeters } from './geocode-cl.mjs';
import { compareAerialSignature } from './aerial-signature-cl.mjs';

// Pesos propios para la sub-señal de "huella física" reutilizando
// calculateMatchScore de matching.mjs (estrategia #4). Distintos de
// DEFAULT_WEIGHTS de matching.mjs porque aquí no hay pHash fiable ni precio
// (no comparamos anuncio-vs-anuncio sino anuncio-vs-metadata-SII) ni
// distancia (eso se resuelve aparte en la estrategia #2/#3).
const CL_FOOTPRINT_WEIGHTS = {
  sqm_diff_pct: -0.5,
  bedrooms_same: 0.3,
  bathrooms_diff: -0.2,
  property_type_same: 0.3,
};

// Pesos del score combinado final de identidad (este módulo, no matching.mjs).
// Reflejan el ranking de fuerza/costo del research: triangulación (1) >
// geocoding (2) > point-in-polygon/pin sospechoso (3) > huella física (4) >
// firma aérea (6, señal complementaria y la más experimental).
export const CL_IDENTITY_WEIGHTS = {
  triangulation: 0.30,
  geocode_pin_agreement: 0.25,
  parcel_found_clean: 0.20,
  pin_suspect_penalty: -0.25,
  footprint_match: 0.15,
  aerial_signal: 0.10,
};

export const CL_IDENTITY_THRESHOLDS = {
  confirmed: 0.75,
  candidate: 0.45,
  pin_suspect: 0.0, // por debajo de candidate pero con pin_suspect detectado explícito
};

const GEOCODE_AGREEMENT_THRESHOLD_M = 150; // mismo orden que distance_m en matching.mjs

// ── Estrategia #1: triangulación entre anuncios ────────────────────────────

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

/**
 * Agrupa candidateListings por señales de identidad compartida (teléfono,
 * agencia, pHash si existiera) y devuelve un score 0..1 de cuánta evidencia
 * de "es la misma propiedad" hay, más el centroide/moda de lat/lng de esos
 * candidatos (más confiable que un pin individual, según el research).
 *
 * Degrada con gracia: phash.mjs hoy devuelve null/[] (deshabilitado), así
 * que la señal de pHash simplemente no contribuye cuando no hay hashes —
 * NO se asume que falta de coincidencia de pHash sea evidencia de "no es la
 * misma propiedad".
 */
function triangulateListings(listing, candidateListings = []) {
  if (!Array.isArray(candidateListings) || candidateListings.length === 0) {
    return { score: 0, matchedBy: [], centroid: null, sampleSize: 0 };
  }

  const listingPhone = normalizePhone(listing?.phone);
  const listingAgency = listing?.agency_name ? String(listing.agency_name).trim().toLowerCase() : null;
  const listingHashes = Array.isArray(listing?.photo_phashes) ? listing.photo_phashes.filter(Boolean) : [];

  let phoneMatches = 0;
  let agencyMatches = 0;
  let phashMatches = 0;
  const latLngs = [];
  if (Number.isFinite(listing?.lat) && Number.isFinite(listing?.lng)) {
    latLngs.push({ lat: listing.lat, lng: listing.lng });
  }

  for (const cand of candidateListings) {
    const candPhone = normalizePhone(cand?.phone);
    if (listingPhone && candPhone && listingPhone === candPhone) phoneMatches++;

    const candAgency = cand?.agency_name ? String(cand.agency_name).trim().toLowerCase() : null;
    if (listingAgency && candAgency && listingAgency === candAgency) agencyMatches++;

    const candHashes = Array.isArray(cand?.photo_phashes) ? cand.photo_phashes.filter(Boolean) : [];
    if (listingHashes.length > 0 && candHashes.length > 0) {
      const shared = listingHashes.some((h) => candHashes.includes(h));
      if (shared) phashMatches++;
    }

    if (Number.isFinite(cand?.lat) && Number.isFinite(cand?.lng)) {
      latLngs.push({ lat: cand.lat, lng: cand.lng });
    }
  }

  const matchedBy = [];
  let score = 0;
  // Teléfono compartido es la señal más fuerte (mismo vendedor/agencia
  // republicando) — un solo match ya es indicio fuerte.
  if (phoneMatches > 0) {
    matchedBy.push('phone');
    score += Math.min(1, 0.5 + 0.15 * phoneMatches);
  }
  if (agencyMatches > 0) {
    matchedBy.push('agency');
    score += Math.min(0.4, 0.15 * agencyMatches);
  }
  if (phashMatches > 0) {
    matchedBy.push('phash');
    score += Math.min(0.6, 0.3 * phashMatches);
  }

  score = Math.max(0, Math.min(1, score));

  // Centroide/moda de lat/lng de todas las observaciones (anuncio + candidatos
  // que sí matchearon por alguna señal fuerte) — más robusto que un solo pin.
  // Si no hay ningún match real, no tiene sentido promediar candidatos no
  // relacionados, así que el centroide queda null.
  const centroid =
    matchedBy.length > 0 && latLngs.length > 0
      ? {
          lat: latLngs.reduce((s, p) => s + p.lat, 0) / latLngs.length,
          lng: latLngs.reduce((s, p) => s + p.lng, 0) / latLngs.length,
        }
      : null;

  return { score, matchedBy, centroid, sampleSize: latLngs.length };
}

// ── Estrategia #2: geocoding vs pin ─────────────────────────────────────────

async function checkGeocodeAgreement(listing) {
  if (!Number.isFinite(listing?.lat) || !Number.isFinite(listing?.lng)) {
    return { available: false, agrees: null, distance_m: null, geocoded: null };
  }

  const geocoded = await geocodeAddressCl({ address: listing?.address, comuna: listing?.comuna });
  if (!geocoded) {
    return { available: false, agrees: null, distance_m: null, geocoded: null };
  }

  const distance_m = distanceMeters({ lat: listing.lat, lng: listing.lng }, geocoded);
  const agrees = distance_m !== null ? distance_m <= GEOCODE_AGREEMENT_THRESHOLD_M : null;

  return { available: true, agrees, distance_m, geocoded };
}

// ── Estrategia #3: point-in-polygon + detector de pin sospechoso ───────────

// Heurísticas de "pin puesto a mano" / sospechoso: coordenadas con
// decimales redondos (ej. -33.4000, -70.6000) sugieren que alguien arrastró
// el pin al centro aproximado de un mapa en vez de geolocalizar la propiedad
// real.
function hasSuspiciousRoundCoords(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const round = (n, decimals) => {
    const factor = 10 ** decimals;
    return Math.round(n * factor) / factor === n;
  };
  // 3 o menos decimales en AMBOS ejes es sospechosamente redondo para un pin
  // residencial (equivale a ~110m de resolución o peor).
  const latDecimals = (String(lat).split('.')[1] || '').length;
  const lngDecimals = (String(lng).split('.')[1] || '').length;
  return latDecimals <= 3 && lngDecimals <= 3;
}

function extractCentroid(parcel) {
  if (!parcel) return null;
  if (parcel.centroid && Number.isFinite(parcel.centroid.lat) && Number.isFinite(parcel.centroid.lng)) {
    return parcel.centroid;
  }
  // Fallback defensivo si cadastre-cl.mjs expone otra forma — supuesto
  // abierto, ver cabecera del archivo.
  return null;
}

async function resolveParcel({ listing, findParcelByPoint }) {
  if (typeof findParcelByPoint !== 'function') {
    return { parcel: null, pinSuspect: false, reason: 'findParcelByPoint no inyectado' };
  }
  if (!Number.isFinite(listing?.lat) || !Number.isFinite(listing?.lng)) {
    return { parcel: null, pinSuspect: false, reason: 'listing sin lat/lng' };
  }

  let parcel = null;
  try {
    parcel = await findParcelByPoint(listing.lat, listing.lng);
  } catch (err) {
    return { parcel: null, pinSuspect: false, reason: `findParcelByPoint lanzó error: ${err.message || err}` };
  }

  const pinSuspect = hasSuspiciousRoundCoords(listing.lat, listing.lng);

  return { parcel: parcel || null, pinSuspect, reason: parcel ? null : 'sin parcela en ese punto' };
}

// ── Estrategia #4: huella física vs metadata SII (delegado a matching.mjs) ─

function scoreFootprintMatch(listing, parcel) {
  // Sin metadata SII (m²/destino) en la parcela candidata no hay nada que
  // comparar — degradar con gracia. `parcel` puede no traer estos campos
  // todavía si cadastre-cl.mjs aún no los puebla; ver supuestos abiertos.
  const sii = parcel?.sii_metadata || parcel?.metadata || null;
  if (!sii) return { available: false, score: 0, components: {} };

  const signals = {};
  if (Number.isFinite(listing?.sqm) && Number.isFinite(sii.sqm)) {
    signals.sqm_diff_pct = (Math.abs(listing.sqm - sii.sqm) / Math.max(listing.sqm, sii.sqm)) * 100;
  }
  if (Number.isFinite(listing?.bedrooms) && Number.isFinite(sii.bedrooms)) {
    signals.bedrooms_same = listing.bedrooms === sii.bedrooms;
  }
  if (Number.isFinite(listing?.bathrooms) && Number.isFinite(sii.bathrooms)) {
    signals.bathrooms_diff = Math.abs(listing.bathrooms - sii.bathrooms);
  }
  if (listing?.property_type && sii.property_type) {
    signals.property_type_same = String(listing.property_type).toLowerCase() === String(sii.property_type).toLowerCase();
  }

  if (Object.keys(signals).length === 0) {
    return { available: false, score: 0, components: {} };
  }

  const result = calculateMatchScore(signals, CL_FOOTPRINT_WEIGHTS);
  return { available: true, score: result.score, components: result.components, explanation: result.explanation };
}

// ── Estrategia #6: firma aérea ──────────────────────────────────────────────

async function scoreAerialSignature(listing, parcel) {
  const centroid = extractCentroid(parcel);
  if (!centroid || !Number.isFinite(listing?.lat) || !Number.isFinite(listing?.lng)) {
    return { available: false, signal_strength: 0, detail: null };
  }

  try {
    const result = await compareAerialSignature({ lat: listing.lat, lng: listing.lng }, centroid);
    const available = result.provider_errors.length === 0 || result.pool_match !== null;
    return { available, signal_strength: result.signal_strength, detail: result };
  } catch (err) {
    return { available: false, signal_strength: 0, detail: null, error: err.message || String(err) };
  }
}

// ── Orquestador principal ───────────────────────────────────────────────────

/**
 * Resuelve la identidad catastral de una propiedad combinando las 6
 * estrategias documentadas.
 *
 * @param {object} params
 * @param {object} params.listing - Anuncio a resolver (ver contrato arriba).
 * @param {object[]} [params.candidateListings] - Otros anuncios candidatos a
 *   ser la misma propiedad (triangulación).
 * @param {(lat:number, lng:number) => Promise<object|null>|object|null} params.findParcelByPoint
 *   - Función inyectada que expone `cadastre-cl.mjs` (point-in-polygon). Ver
 *   contrato esperado en la cabecera del archivo. Acepta tanto sync como
 *   async.
 * @returns {Promise<{
 *   location_confidence: 'none'|'candidate'|'pin_suspect'|'confirmed',
 *   rol_matriz: string|null,
 *   rol_unidad: string|null,
 *   score: number,
 *   signals: object,
 *   explanation: string
 * }>}
 */
export async function resolvePropertyIdentity({ listing, candidateListings = [], findParcelByPoint } = {}) {
  if (!listing) {
    return {
      location_confidence: 'none',
      rol_matriz: null,
      rol_unidad: null,
      score: 0,
      signals: {},
      explanation: 'Sin listing de entrada',
    };
  }

  const triangulation = triangulateListings(listing, candidateListings);
  const geocodeCheck = await checkGeocodeAgreement(listing);
  const { parcel, pinSuspect, reason: parcelReason } = await resolveParcel({ listing, findParcelByPoint });
  const footprint = scoreFootprintMatch(listing, parcel);
  const aerial = await scoreAerialSignature(listing, parcel);

  // Combinar en un score 0..1 propio (no pasa por matching.mjs porque las
  // signal names de aquí — triangulation, geocode_pin_agreement, etc. — no
  // son las que matching.mjs reconoce; sería ignoradas silenciosamente por
  // su `default: continue`).
  let raw = 0;
  const components = {};

  components.triangulation = CL_IDENTITY_WEIGHTS.triangulation * triangulation.score;
  raw += components.triangulation;

  if (geocodeCheck.available && geocodeCheck.agrees !== null) {
    const contrib = CL_IDENTITY_WEIGHTS.geocode_pin_agreement * (geocodeCheck.agrees ? 1 : -1);
    components.geocode_pin_agreement = contrib;
    raw += contrib;
  }

  if (parcel && !pinSuspect) {
    components.parcel_found_clean = CL_IDENTITY_WEIGHTS.parcel_found_clean;
    raw += components.parcel_found_clean;
  }
  if (pinSuspect) {
    components.pin_suspect_penalty = CL_IDENTITY_WEIGHTS.pin_suspect_penalty;
    raw += components.pin_suspect_penalty;
  }

  if (footprint.available) {
    const contrib = CL_IDENTITY_WEIGHTS.footprint_match * footprint.score;
    components.footprint_match = contrib;
    raw += contrib;
  }

  if (aerial.available) {
    const contrib = CL_IDENTITY_WEIGHTS.aerial_signal * aerial.signal_strength;
    components.aerial_signal = contrib;
    raw += contrib;
  }

  // Normalizar a 0..1 con sigmoid suave, mismo patrón que matching.mjs, para
  // mantener consistencia de vocabulario entre los scores de ambos países.
  const score = 1 / (1 + Math.exp(-raw * 3));

  // Mapeo a location_confidence. pin_suspect tiene prioridad de reporte sobre
  // 'candidate' aunque el score numérico caiga en el rango de candidate,
  // porque es información operativa relevante (alguien debe revisar el pin)
  // independientemente del score combinado.
  let location_confidence;
  if (pinSuspect && score < CL_IDENTITY_THRESHOLDS.confirmed) {
    location_confidence = 'pin_suspect';
  } else if (score >= CL_IDENTITY_THRESHOLDS.confirmed && parcel) {
    location_confidence = 'confirmed';
  } else if (score >= CL_IDENTITY_THRESHOLDS.candidate) {
    location_confidence = 'candidate';
  } else {
    location_confidence = 'none';
  }

  const rol_matriz = parcel?.rol_matriz ?? parcel?.rol ?? null;
  const rol_unidad = parcel?.rol_unidad ?? null;

  const explanationParts = [
    `score=${score.toFixed(3)}`,
    `triangulation=${triangulation.score.toFixed(2)}(${triangulation.matchedBy.join('|') || 'none'})`,
    geocodeCheck.available
      ? `geocode_agrees=${geocodeCheck.agrees}(${geocodeCheck.distance_m?.toFixed(0)}m)`
      : 'geocode=unavailable',
    parcel ? `parcel=${parcel.rol || 'found'}` : `parcel=none(${parcelReason})`,
    pinSuspect ? 'pin_suspect=true' : null,
    footprint.available ? `footprint=${footprint.score.toFixed(2)}` : null,
    aerial.available ? `aerial=${aerial.signal_strength.toFixed(2)}` : null,
  ].filter(Boolean);

  return {
    location_confidence,
    rol_matriz,
    rol_unidad,
    score,
    signals: {
      triangulation,
      geocode: geocodeCheck,
      parcel: parcel ? { rol: parcel.rol, rol_matriz: parcel.rol_matriz, rol_unidad: parcel.rol_unidad, source: parcel.source } : null,
      pin_suspect: pinSuspect,
      footprint,
      aerial,
      components,
    },
    explanation: explanationParts.join('; '),
  };
}
