// ─────────────────────────────────────────────────────────────────────────────
// Pipeline de media a bucket, con dedup de fotos (plan Anuncios CL · H7).
//
// syncListingMediaCl descarga las fotos de un listing, las deduplica por
// contenido (content_hash exacto) y por percepción (phash + Hamming distance,
// para recompresiones/reescalados del mismo archivo original — el caso de
// "misma corredora, mismo CDN, calidad ligeramente distinta"), y solo sube a
// Hetzner Object Storage lo genuinamente nuevo. Nunca vuelve a descargar+subir
// una foto cuyo content_hash ya está en media_assets_cl.
//
// `s3` y `download` son inyectables (mismo patrón que resilient-fetch.mjs)
// para poder testear la lógica de dedup con un bucket simulado en memoria, sin
// credenciales reales ni red — ver cabecera de hetzner-s3.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto'
import { calculatePhashFromBuffer } from './phash.mjs'

const DEFAULT_HAMMING_THRESHOLD = 8 // "casi-idénticas" (mismo rango que isImageDuplicate de phash.mjs)

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function guessContentType(url) {
  const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  return 'image/jpeg' // default razonable: la gran mayoría de fotos de ML/portales
}

/** Descarga por defecto: fetch nativo de Node, en memoria, sin archivos temporales. */
async function defaultDownload(url, { timeoutMs = 15000 } = {}) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'casafari-mio-scraper/1.0' },
    })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 0 ? buf : null
  } catch {
    return null
  }
}

/**
 * Sincroniza las fotos de un listing al bucket, con dedup por contenido.
 *
 * @param {import('pg').Client} client
 * @param {{ putObject: (args: {key: string, body: Buffer, contentType?: string}) => Promise<string> }} s3
 * @param {string} listingId
 * @param {string[]} photoUrls
 * @param {{ download?: Function, hammingThreshold?: number, cropBorderPx?: number }} [options]
 */
export async function syncListingMediaCl(client, s3, listingId, photoUrls, options = {}) {
  const {
    download = defaultDownload,
    hammingThreshold = DEFAULT_HAMMING_THRESHOLD,
    cropBorderPx = 0,
  } = options

  const results = []

  for (const url of photoUrls) {
    const buffer = await download(url)
    if (!buffer) {
      results.push({ url, ok: false, reason: 'download_failed' })
      continue
    }

    const contentHash = sha256Hex(buffer)

    // 1) Dedup exacto: ¿ya existe este content_hash? No re-descarga (ya se
    // descargó arriba, inevitable para poder hashear) pero NO re-sube.
    const { rows: exact } = await client.query(
      `SELECT bucket_url FROM media_assets_cl WHERE content_hash = $1`,
      [contentHash]
    )
    if (exact.length > 0) {
      await client.query(
        `UPDATE media_assets_cl SET ref_count = ref_count + 1 WHERE content_hash = $1`,
        [contentHash]
      )
      results.push({ url, ok: true, contentHash, bucketUrl: exact[0].bucket_url, reused: 'exact' })
      continue
    }

    const phash = await calculatePhashFromBuffer(buffer, { crop_border_px: cropBorderPx })

    // 2) Dedup perceptual: mismo archivo original, recomprimido/reescalado
    // (content_hash distinto, imagen igual) → reutiliza el bucket_url ya
    // subido en vez de crear un objeto duplicado.
    let reuseBucketUrl = null
    if (phash) {
      const { rows: near } = await client.query(
        `SELECT bucket_url, hamming_distance(phash, $1) AS dist
         FROM media_assets_cl
         WHERE phash IS NOT NULL AND hamming_distance(phash, $1) <= $2
         ORDER BY dist ASC LIMIT 1`,
        [phash, hammingThreshold]
      )
      if (near.length > 0) reuseBucketUrl = near[0].bucket_url
    }

    const bucketUrl = reuseBucketUrl
      ?? await s3.putObject({ key: contentHash, body: buffer, contentType: guessContentType(url) })

    await client.query(
      `INSERT INTO media_assets_cl (content_hash, phash, bucket_url, bytes, ref_count)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (content_hash) DO NOTHING`,
      [contentHash, phash, bucketUrl, buffer.length]
    )
    results.push({ url, ok: true, contentHash, phash, bucketUrl, reused: reuseBucketUrl ? 'phash' : false })
  }

  const storedPhotos = results
    .filter((r) => r.ok)
    .map((r) => ({ original_url: r.url, bucket_url: r.bucketUrl, phash: r.phash ?? null, content_hash: r.contentHash }))

  await client.query(
    `UPDATE listings_cl SET stored_photos = $2, media_synced_at = now(), updated_at = now() WHERE id = $1`,
    [listingId, JSON.stringify(storedPhotos)]
  )

  return {
    total: photoUrls.length,
    uploaded: results.filter((r) => r.ok && r.reused === false).length,
    reused: results.filter((r) => r.ok && r.reused).length,
    failed: results.filter((r) => !r.ok).length,
    storedPhotos,
  }
}
