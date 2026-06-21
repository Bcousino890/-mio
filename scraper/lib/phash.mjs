import sharp from 'sharp';

// ─────────────────────────────────────────────────────────────────────────────
// Perceptual hash (dHash — "difference hash") vía `sharp`, 100% async/buffer.
//
// Migrado desde `imghash` 0.0.9 (callback-based, exige escribir a un archivo
// temporal en disco — no async-friendly, ver TODO histórico de este archivo).
// `sharp` ya es dependencia del repo (scraper/package.json) y se usa con el
// mismo patrón buffer-in/raw-pixels-out en scraper/lib/aerial-signature-cl.mjs.
//
// Algoritmo dHash clásico (Neal Krawetz): para cada fila de una grilla de
// 9x8 píxeles en escala de grises se compara cada píxel contra el siguiente
// de la misma fila (8 comparaciones x 8 filas = 64 bits). Es robusto a
// pequeños cambios de brillo/contraste/escala (a diferencia de un hash
// criptográfico) y barato de calcular — adecuado para "¿son la misma foto,
// posiblemente reescalada/recomprimida por un portal distinto?", que es
// justo el caso de uso de la estrategia #1 (triangulación) tanto en España
// como, de forma aún más crítica, en Chile (ver
// docs/research-portalinmobiliario-chile.md: ancla de identidad cuando la
// ubicación declarada no es confiable).
//
// Formato de salida: string hex de 16 caracteres (64 bits), SIN prefijo "0x",
// zero-padded — el mismo formato que ya asume `hammingDistance()` más abajo,
// `matching.mjs` (`phash_distance`) y la función SQL `hamming_distance()` de
// db/migrations/0014_dedup_scoring.sql (hace `('x' || phash)::bit(64)`, que
// exige exactamente 16 hex chars).
// ─────────────────────────────────────────────────────────────────────────────

const HASH_GRID_WIDTH = 9; // 9 columnas -> 8 diffs por fila
const HASH_GRID_HEIGHT = 8; // 8 filas -> 64 bits totales

/**
 * Calcula el dHash de un buffer de imagen ya descargado.
 * No hace I/O de red ni de disco — sólo decodifica/procesa en memoria.
 *
 * @param {Buffer} imageBuffer
 * @param {object} [options]
 * @param {number} [options.crop_border_px=0] - Recorta un borde fijo (px) de
 *   los 4 lados antes de hashear, útil para ignorar watermarks/marcos de
 *   portal que de otro modo dominarían el hash.
 * @returns {Promise<string|null>} hash hex de 16 chars, o null si la imagen
 *   no se pudo decodificar o quedó vacía tras el recorte.
 */
export async function calculatePhashFromBuffer(imageBuffer, options = {}) {
  if (!imageBuffer || imageBuffer.length === 0) return null;

  const { crop_border_px = 0 } = options;

  try {
    let pipeline = sharp(imageBuffer).rotate(); // respeta EXIF orientation

    if (crop_border_px > 0) {
      const meta = await sharp(imageBuffer).metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;
      const left = Math.min(crop_border_px, Math.floor(w / 2) - 1);
      const top = Math.min(crop_border_px, Math.floor(h / 2) - 1);
      if (left > 0 && top > 0 && w - 2 * left > 0 && h - 2 * top > 0) {
        pipeline = pipeline.extract({ left, top, width: w - 2 * left, height: h - 2 * top });
      }
    }

    const { data } = await pipeline
      .grayscale()
      .resize(HASH_GRID_WIDTH, HASH_GRID_HEIGHT, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (!data || data.length < HASH_GRID_WIDTH * HASH_GRID_HEIGHT) return null;

    // Para cada fila, comparar cada píxel contra el siguiente -> 1 si decrece
    // brillo (izq > der), 0 si no. 8 filas x 8 bits = 64 bits.
    let bits = '';
    for (let row = 0; row < HASH_GRID_HEIGHT; row++) {
      for (let col = 0; col < HASH_GRID_WIDTH - 1; col++) {
        const left = data[row * HASH_GRID_WIDTH + col];
        const right = data[row * HASH_GRID_WIDTH + col + 1];
        bits += left > right ? '1' : '0';
      }
    }

    // 64 bits -> 16 hex chars, zero-padded.
    const hex = BigInt(`0b${bits}`).toString(16).padStart(16, '0');
    return hex;
  } catch {
    // Imagen corrupta, formato no soportado, etc. — degradar a null, nunca lanzar.
    return null;
  }
}

/**
 * Descarga una URL de imagen y calcula su pHash (dHash), todo en memoria
 * (sin archivos temporales), async de punta a punta.
 *
 * @param {string} imageUrl - URL de la imagen
 * @param {object} [options] - {timeout_ms=10000, crop_border_px=0}
 * @returns {Promise<string|null>} hash hex de 16 chars, o null si falla
 *   la descarga o la imagen no se pudo procesar.
 */
export async function calculatePhashFromUrl(imageUrl, options = {}) {
  if (!imageUrl) return null;
  const { timeout_ms = 10000, crop_border_px = 0 } = options;

  try {
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(timeout_ms),
      headers: { 'User-Agent': 'casafari-mio-scraper/1.0' },
    });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0) return null;
    return await calculatePhashFromBuffer(buffer, { crop_border_px });
  } catch {
    // Red caída, timeout, imagen inválida, etc. — degradar a null, nunca lanzar.
    return null;
  }
}

/**
 * Calcula pHash para múltiples URLs en paralelo (con límite de concurrencia),
 * sin bloquear el event loop: cada descarga + procesamiento sharp corre de
 * forma async, y el límite de concurrencia evita saturar red/CPU.
 *
 * @param {string[]} imageUrls - Array de URLs
 * @param {number} [concurrency=3] - Máximo de descargas/hashes en paralelo
 * @param {object} [options] - Opciones adicionales, ver calculatePhashFromUrl
 * @returns {Promise<string[]>} Array de hashes hex (omite nulls/fallos)
 */
export async function calculatePhashBatch(imageUrls, concurrency = 3, options = {}) {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) return [];

  const results = [];
  for (let i = 0; i < imageUrls.length; i += concurrency) {
    const batch = imageUrls.slice(i, i + concurrency);
    const batchHashes = await Promise.all(batch.map((url) => calculatePhashFromUrl(url, options)));
    results.push(...batchHashes);
  }
  return results.filter((h) => h !== null);
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
