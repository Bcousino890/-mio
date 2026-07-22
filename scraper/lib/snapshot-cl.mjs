// ─────────────────────────────────────────────────────────────────────────────
// Snapshots crudos inmutables (plan Anuncios CL · H13 + H18).
//
// recordSnapshotCl(client, listingId, data, capturedAt) registra el estado
// crudo de un listing en cada pasada del scraper, sin sobrescribir nada:
//   - Si el contenido normalizado es IGUAL al de la fila-puntero vigente
//     (listing_snapshots_cl más reciente de ese listing), NO inserta nada
//     nuevo — solo corre `last_seen_at` hacia adelante. El blob pesado
//     (snapshot_blobs_cl) ya existe, se reutiliza por content_hash.
//   - Si cambió (o es la primera vez que se ve este listing), cierra
//     implícitamente la fila anterior (deja de tocarla) y abre una nueva.
//
// `data` debe ser el JSON ya normalizado que se quiere persistir como snapshot
// (ej. el resultado de parseDetailPage) — esta función es agnóstica de qué
// campos trae, solo lo hashea y lo guarda.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto'

/**
 * Serialización canónica: mismas claves en el mismo orden (alfabético,
 * recursivo) para que dos objetos semánticamente iguales con distinto orden
 * de inserción produzcan el MISMO content_hash. `JSON.stringify` normal no lo
 * garantiza (respeta el orden de inserción de claves).
 */
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`
}

export function contentHashOf(data) {
  return createHash('sha256').update(canonicalStringify(data)).digest('hex')
}

/**
 * Registra un snapshot para `listingId`. Idempotente y seguro de llamar en
 * cada pasada del scraper, sin importar si el contenido cambió o no.
 *
 * @param {import('pg').Client} client
 * @param {string} listingId
 * @param {object} data - JSON normalizado a persistir como snapshot
 * @param {Date} [capturedAt] - momento de esta pasada (default: now)
 * @returns {Promise<{ changed: boolean, snapshotId: string, contentHash: string }>}
 */
export async function recordSnapshotCl(client, listingId, data, capturedAt = new Date()) {
  const contentHash = contentHashOf(data)

  const { rows: currentRows } = await client.query(
    `SELECT id, content_hash, last_seen_at FROM listing_snapshots_cl
     WHERE listing_id = $1 ORDER BY first_captured_at DESC LIMIT 1`,
    [listingId]
  )
  const current = currentRows[0] ?? null

  if (current && current.content_hash === contentHash) {
    // Sin cambios: solo correr last_seen_at hacia adelante (nunca hacia
    // atrás, por si esta llamada trae un capturedAt más viejo que el vigente).
    if (new Date(capturedAt) > new Date(current.last_seen_at)) {
      await client.query(
        `UPDATE listing_snapshots_cl SET last_seen_at = $2 WHERE id = $1`,
        [current.id, capturedAt]
      )
    }
    return { changed: false, snapshotId: current.id, contentHash }
  }

  // Contenido nuevo (o primer snapshot de este listing): asegurar el blob
  // (dedup por content_hash — si otro listing ya tuvo exactamente este mismo
  // JSON, se reutiliza sin volver a guardarlo) y abrir una fila-puntero nueva.
  const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8')
  await client.query(
    `INSERT INTO snapshot_blobs_cl (content_hash, raw_json, bytes)
     VALUES ($1, $2, $3) ON CONFLICT (content_hash) DO NOTHING`,
    [contentHash, JSON.stringify(data), bytes]
  )

  const { rows: inserted } = await client.query(
    `INSERT INTO listing_snapshots_cl (listing_id, content_hash, first_captured_at, last_seen_at)
     VALUES ($1, $2, $3, $3) RETURNING id`,
    [listingId, contentHash, capturedAt]
  )

  return { changed: true, snapshotId: inserted[0].id, contentHash }
}
