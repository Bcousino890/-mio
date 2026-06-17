/**
 * Motor de scoring multi-señal para deduplicación de anuncios de propiedades.
 * Combina señales atómicas (calculadas en SQL) con pesos configurables.
 * Sigue el patrón Fellegi-Sunter simplificado.
 */

// Pesos por defecto (tuneables)
const DEFAULT_WEIGHTS = {
  distance_m: -0.15,          // penalización por distancia
  sqm_diff_pct: -0.10,        // penalización por diferencia de m²
  bedrooms_same: 0.15,        // bonificación si coinciden exactamente
  bathrooms_diff: -0.05,      // penalización leve por diferencia
  price_diff_pct: -0.08,      // penalización por diferencia de precio
  text_similarity: 0.12,      // bonificación por similitud de descripción
  phash_distance: -0.20,      // penalización fuerte si pHash diferente
  property_type_same: 0.10,   // bonificación si es el mismo tipo
  operation_same: 0.10        // bonificación si es misma operación (venta/alquiler)
};

/**
 * Calcula un score (0..1) a partir de señales atómicas crudas.
 * Implementa una versión simplificada de Fellegi-Sunter.
 *
 * @param {object} signals - Objeto con señales: {distance_m, sqm_diff_pct, bedrooms_same, ...}
 * @param {object} weights - Pesos por señal (por defecto DEFAULT_WEIGHTS)
 * @returns {object} - {score: 0..1, components: {sig_name: contribution, ...}, explanation: string}
 */
export function calculateMatchScore(signals, weights = DEFAULT_WEIGHTS) {
  if (!signals) return { score: 0, components: {}, explanation: 'Sin señales' };

  const components = {};
  let totalScore = 0;

  // Procesar cada señal
  for (const [signalName, rawValue] of Object.entries(signals)) {
    if (rawValue === null || rawValue === undefined) continue;

    const weight = weights[signalName] ?? 0;
    let contribution = 0;

    // Normalizar cada tipo de señal a escala -1..1, luego multiplicar por peso
    switch (signalName) {
      case 'distance_m': {
        // Función decreciente: 0m=0, 150m=-1
        const normalized = Math.min(1, Math.max(0, rawValue / 150));
        contribution = weight * normalized;
        break;
      }

      case 'sqm_diff_pct': {
        // Penalización por diferencia % (normalizado a 0..1)
        // Si diferencia es >50%, penalización máxima
        const normalized = Math.min(1, Math.max(0, rawValue / 50));
        contribution = weight * normalized;
        break;
      }

      case 'bedrooms_same': {
        // Boolean: 1 si coinciden, 0 si no
        contribution = weight * (rawValue ? 1 : 0);
        break;
      }

      case 'bathrooms_diff': {
        // Penalización por diferencia de baños (0, 1, 2+)
        const normalized = Math.min(1, Math.max(0, rawValue / 3));
        contribution = weight * normalized;
        break;
      }

      case 'price_diff_pct': {
        // Penalización por diferencia de precio
        // Si diferencia es >50%, penalización máxima
        const normalized = Math.min(1, Math.max(0, rawValue / 50));
        contribution = weight * normalized;
        break;
      }

      case 'text_similarity': {
        // Similitud de trigrama (0..1) se usa directamente
        contribution = weight * rawValue;
        break;
      }

      case 'phash_distance': {
        // Hamming distance: máximo 64 bits para pHash de 64 bits
        // Si distancia >16, penalización máxima (imágenes muy diferentes)
        if (rawValue === null) {
          contribution = weight * 0.5; // penalización moderada si no hay pHash
        } else {
          const normalized = Math.min(1, Math.max(0, rawValue / 16));
          contribution = weight * normalized;
        }
        break;
      }

      case 'property_type_same':
      case 'operation_same': {
        // Boolean: 1 si coinciden, 0 si no
        contribution = weight * (rawValue ? 1 : 0);
        break;
      }

      default:
        // Ignorar señales desconocidas
        continue;
    }

    components[signalName] = contribution;
    totalScore += contribution;
  }

  // Normalizar a 0..1 (sumamos max ~0.92, min ~-0.83)
  // Aplicamos sigmoid suave para normalizar
  const normalizedScore = sigmoid(totalScore);

  return {
    score: normalizedScore,
    components,
    rawScore: totalScore,
    explanation: explainScore(normalizedScore, signals, components)
  };
}

/**
 * Función sigmoid para normalizar scores a 0..1.
 * @param {number} x
 * @returns {number} - Valor entre 0..1
 */
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x * 2)); // factor 2 para ajustar la pendiente
}

/**
 * Genera explicación human-readable del score.
 */
function explainScore(score, signals, components) {
  const positives = Object.entries(components)
    .filter(([_, v]) => v > 0.01)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, v]) => `+${k}(${v.toFixed(3)})`)
    .join(', ');

  const negatives = Object.entries(components)
    .filter(([_, v]) => v < -0.01)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(([k, v]) => `${k}(${v.toFixed(3)})`)
    .join(', ');

  return `score=${score.toFixed(3)} (${positives}${negatives ? '; ' + negatives : ''})`;
}

/**
 * Determina decisión (auto-merge, candidate para review, o reject) basado en umbral.
 * @param {number} score - Score normalizado (0..1)
 * @param {object} thresholds - {auto: 0.90, review_min: 0.75}
 * @returns {object} - {status: 'confirmed'|'candidate'|'rejected', reason: string}
 */
export function makeDecision(score, thresholds = { auto: 0.90, review_min: 0.75 }) {
  if (score >= thresholds.auto) {
    return {
      status: 'confirmed',
      decided_by: 'auto',
      reason: `Score ${score.toFixed(3)} >= ${thresholds.auto}`
    };
  } else if (score >= thresholds.review_min) {
    return {
      status: 'candidate',
      decided_by: 'auto',
      reason: `Score ${score.toFixed(3)} in review zone [${thresholds.review_min}, ${thresholds.auto})`
    };
  } else {
    return {
      status: 'rejected',
      decided_by: 'auto',
      reason: `Score ${score.toFixed(3)} < ${thresholds.review_min}`
    };
  }
}

/**
 * Pipeline completo: señales → score → decisión.
 * @param {object} signals - Señales crudas
 * @param {object} weights - Pesos personalizados
 * @param {object} thresholds - Umbrales de decisión
 * @returns {object} - {score, decision, components, explanation}
 */
export function evaluateMatch(signals, weights = DEFAULT_WEIGHTS, thresholds = { auto: 0.90, review_min: 0.75 }) {
  const scoreResult = calculateMatchScore(signals, weights);
  const decision = makeDecision(scoreResult.score, thresholds);

  return {
    ...scoreResult,
    decision,
    signals
  };
}
