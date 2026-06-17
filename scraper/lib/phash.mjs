import sharp from 'sharp';

/**
 * Calcula pHash (perceptual hash) de una URL de imagen.
 * Por ahora deshabilitado: imghash 0.0.9 requiere archivo, no buffer.
 * TODO: Migrar a biblioteca async-friendly (blockhash, dhash, etc.)
 *
 * @param {string} imageUrl - URL de la imagen
 * @param {object} options - {timeout_ms: 10000, crop_border_px: 0}
 * @returns {Promise<string|null>} - null por ahora (phashing deshabilitado)
 */
export async function calculatePhashFromUrl(imageUrl, options = {}) {
  // Phashing deshabilitado temporalmente - imghash 0.0.9 es callback-based y requiere archivos
  // El scraping continúa sin phashing. Migrar a biblioteca moderna cuando sea posible.
  return null;
}

/**
 * Calcula pHash para múltiples URLs en paralelo (con límite de concurrencia).
 * Actualmente deshabilitado (phashing deshabilitado).
 * @param {string[]} imageUrls - Array de URLs
 * @param {number} concurrency - Máximo de descargas paralelas
 * @param {object} options - Opciones adicionales
 * @returns {Promise<string[]>} - Array vacío (phashing deshabilitado)
 */
export async function calculatePhashBatch(imageUrls, concurrency = 3, options = {}) {
  return [];
}

/**
 * Calcula Hamming distance entre dos pHash (ambos como strings hex de 64 bits).
 * Retorna número de bits diferentes (0-64 para pHash de 64 bits).
 * @param {string} hash1 - pHash hex (p.ej. "abcd1234...")
 * @param {string} hash2 - pHash hex
 * @returns {number|null} - Hamming distance o null si no son válidos
 */
export function hammingDistance(hash1, hash2) {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) return null;

  try {
    const bin1 = BigInt(`0x${hash1}`).toString(2).padStart(64, '0');
    const bin2 = BigInt(`0x${hash2}`).toString(2).padStart(64, '0');

    let distance = 0;
    for (let i = 0; i < bin1.length; i++) {
      if (bin1[i] !== bin2[i]) distance++;
    }
    return distance;
  } catch {
    return null;
  }
}

/**
 * Determina si dos imágenes son duplicados basado en Hamming distance.
 * @param {string} hash1 - pHash hex
 * @param {string} hash2 - pHash hex
 * @param {number} threshold - Umbral de distancia Hamming (recomendado: 5-10 para "casi-idénticas")
 * @returns {boolean}
 */
export function isImageDuplicate(hash1, hash2, threshold = 10) {
  const distance = hammingDistance(hash1, hash2);
  return distance !== null && distance <= threshold;
}
