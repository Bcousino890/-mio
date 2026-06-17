import sharp from 'sharp';
import imghash from 'imghash';

/**
 * Calcula pHash (perceptual hash) de una URL de imagen.
 * Descarga el buffer en memoria, lo procesa con sharp, y calcula el hash sin guardar archivo.
 *
 * @param {string} imageUrl - URL de la imagen
 * @param {object} options - {timeout_ms: 10000, crop_border_px: 0}
 * @returns {Promise<string|null>} - pHash como string hex (64 bits) o null si falla
 */
export async function calculatePhashFromUrl(imageUrl, options = {}) {
  const { timeout_ms = 10000, crop_border_px = 0 } = options;

  if (!imageUrl) return null;

  try {
    // Fetch con timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout_ms);

    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;

    // Leer buffer en memoria
    const buffer = await response.arrayBuffer();

    // Procesar con sharp (resize, potencialmente crop border si hay marca de agua)
    let image = sharp(buffer);

    if (crop_border_px > 0) {
      const metadata = await image.metadata();
      const { width, height } = metadata;
      if (width && height) {
        image = image.extract({
          left: crop_border_px,
          top: crop_border_px,
          width: Math.max(1, width - 2 * crop_border_px),
          height: Math.max(1, height - 2 * crop_border_px)
        });
      }
    }

    // Redimensionar a tamaño estándar para pHash (típicamente 8x8 para DCT)
    const resized = await image.resize(8, 8, { fit: 'cover' }).raw().toBuffer({ resolveWithObject: true });

    // Calcular pHash usando imghash
    const hash = await imghash.hash.phash(Buffer.from(resized.data));

    return hash;
  } catch (error) {
    // Log silencioso para errores de red/timeout, importante para no frenar el scraping
    if (error.name === 'AbortError') {
      console.debug(`[phash] timeout descargando ${imageUrl}`);
    } else {
      console.debug(`[phash] error: ${error.message}`);
    }
    return null;
  }
}

/**
 * Calcula pHash para múltiples URLs en paralelo (con límite de concurrencia).
 * @param {string[]} imageUrls - Array de URLs
 * @param {number} concurrency - Máximo de descargas paralelas
 * @param {object} options - Opciones adicionales
 * @returns {Promise<string[]>} - Array de hashes (null para URLs que fallaron)
 */
export async function calculatePhashBatch(imageUrls, concurrency = 3, options = {}) {
  const results = [];
  const queue = [...imageUrls];
  const running = [];

  while (queue.length > 0 || running.length > 0) {
    // Llenar pool hasta concurrencia
    while (running.length < concurrency && queue.length > 0) {
      const url = queue.shift();
      const promise = calculatePhashFromUrl(url, options)
        .then(hash => {
          const idx = running.indexOf(promise);
          if (idx > -1) running.splice(idx, 1);
          return hash;
        })
        .catch(() => {
          const idx = running.indexOf(promise);
          if (idx > -1) running.splice(idx, 1);
          return null;
        });
      running.push(promise);
    }

    // Esperar que termine una tarea
    if (running.length > 0) {
      await Promise.race(running);
    }
  }

  return results;
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
