/**
 * arcgis-query.mjs
 *
 * Librería genérica para consultar servicios ArcGIS REST públicos.
 * - Query por geometría (punto, bbox)
 * - Paginación automática
 * - Caché en memoria (opcional)
 * - Retry on rate-limit (429)
 *
 * Uso:
 *   import { queryArcGISByPoint, batchQueryCommune } from './lib/arcgis-query.mjs'
 *
 *   const zona = await queryArcGISByPoint(
 *     'https://services9.arcgis.com/.../PRC_Vitacura/FeatureServer/0',
 *     -70.54, -33.37,  // lng, lat
 *     { outFields: 'zona,nombre', precision: 5 }
 *   )
 */

const ARCGIS_CACHE = {}
const BATCH_DELAY_MS = 100  // Delay entre requests (rate-limit friendly)
const RETRY_ATTEMPTS = 3
const RETRY_DELAY_MS = [1000, 2000, 5000]  // Exponential backoff

/**
 * Query ArcGIS FeatureServer por punto (lat/lng)
 *
 * @param {string} serviceUrl - URL base del servicio (ej. https://services9.arcgis.com/.../FeatureServer/0)
 * @param {number} lng - Longitud (EPSG:4326)
 * @param {number} lat - Latitud (EPSG:4326)
 * @param {object} options - {outFields, precision, extraParams, cache}
 *
 * @returns {object|null} - Feature attributes o null si no hay intersección
 */
export async function queryArcGISByPoint(serviceUrl, lng, lat, options = {}) {
  const {
    outFields = '*',
    precision = 5,
    extraParams = {},
    cache = true,
    timeout = 5000
  } = options

  // ─── Cache ──────────────────────────────────────────────────────────────────
  if (cache) {
    const cacheKey = `${serviceUrl}|${lat.toFixed(precision)},${lng.toFixed(precision)}`
    if (cacheKey in ARCGIS_CACHE) {
      return ARCGIS_CACHE[cacheKey]
    }
  }

  // ─── Query parameters ───────────────────────────────────────────────────────
  const params = new URLSearchParams({
    where: '1=1',
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: outFields,
    returnGeometry: 'false',
    f: 'json',
    ...extraParams
  })

  const url = `${serviceUrl}/query?${params.toString()}`

  // ─── Retry logic ────────────────────────────────────────────────────────────
  let lastError
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'User-Agent': 'casafari-mio/1.0' }
      })

      clearTimeout(timeoutId)

      // 429 = Rate limit
      if (response.status === 429 && attempt < RETRY_ATTEMPTS - 1) {
        const backoffMs = RETRY_DELAY_MS[attempt]
        console.warn(
          `[arcgis-query] 429 Rate limit on ${serviceUrl.split('/').slice(-2).join('/')}, ` +
          `retry in ${backoffMs}ms (attempt ${attempt + 1}/${RETRY_ATTEMPTS})`
        )
        await new Promise(r => setTimeout(r, backoffMs))
        continue
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      // ─── Parse response ─────────────────────────────────────────────────────
      if (data.error) {
        throw new Error(`ArcGIS error: ${data.error.message}`)
      }

      if (!data.features || data.features.length === 0) {
        return null
      }

      const result = data.features[0].attributes || null

      // ─── Cache result ───────────────────────────────────────────────────────
      if (cache && result) {
        const cacheKey = `${serviceUrl}|${lat.toFixed(precision)},${lng.toFixed(precision)}`
        ARCGIS_CACHE[cacheKey] = result
      }

      return result
    } catch (err) {
      lastError = err
      if (attempt < RETRY_ATTEMPTS - 1) {
        const backoffMs = RETRY_DELAY_MS[attempt]
        console.warn(
          `[arcgis-query] Error on attempt ${attempt + 1}/${RETRY_ATTEMPTS}: ${err.message}, ` +
          `retry in ${backoffMs}ms`
        )
        await new Promise(r => setTimeout(r, backoffMs))
      }
    }
  }

  console.error(`[arcgis-query] Failed after ${RETRY_ATTEMPTS} attempts on ${serviceUrl}:`, lastError.message)
  return null
}

/**
 * Batch query por múltiples puntos (roles de una comuna)
 *
 * @param {string} serviceUrl - URL del servicio ArcGIS
 * @param {array} roles - Array de {id, lng, lat, ...}
 * @param {object} options - {workers, outFields, cache, batchSize}
 *
 * @returns {Map<string, object>} - Map de (id/cacheKey) → feature attributes
 */
export async function batchQueryArcGIS(serviceUrl, roles, options = {}) {
  const {
    workers = 5,
    outFields = '*',
    cache = true,
    batchSize = 50,
    delayMs = BATCH_DELAY_MS
  } = options

  const results = new Map()
  const queue = [...roles]
  const activeWorkers = []

  console.log(`[arcgis-batch] Starting ${workers} workers for ${roles.length} roles`)

  // ─── Worker function ────────────────────────────────────────────────────────
  const worker = async () => {
    while (queue.length > 0) {
      const role = queue.shift()
      if (!role) break

      try {
        const feature = await queryArcGISByPoint(
          serviceUrl,
          role.lng,
          role.lat,
          { outFields, cache, timeout: 10000 }
        )

        const cacheKey = `${role.id}` || `${role.lat.toFixed(5)},${role.lng.toFixed(5)}`
        results.set(cacheKey, feature)

        // Rate-limit friendly
        await new Promise(r => setTimeout(r, delayMs))
      } catch (err) {
        console.error(`[arcgis-batch] Error processing role ${role.id}:`, err.message)
        results.set(`${role.id}`, null)
      }
    }
  }

  // ─── Spawn workers ──────────────────────────────────────────────────────────
  for (let i = 0; i < workers; i++) {
    activeWorkers.push(worker())
  }

  await Promise.all(activeWorkers)

  console.log(`[arcgis-batch] Completed. Got ${results.size} results`)
  return results
}

/**
 * Query por bbox (bounding box)
 *
 * @param {string} serviceUrl - URL del servicio ArcGIS
 * @param {number} minX, minY, maxX, maxY - Bbox (EPSG:4326)
 * @param {object} options - {outFields, extraParams, ...}
 *
 * @returns {array} - Array de features
 */
export async function queryArcGISByBbox(serviceUrl, minX, minY, maxX, maxY, options = {}) {
  const {
    outFields = '*',
    extraParams = {},
    timeout = 10000
  } = options

  const params = new URLSearchParams({
    where: '1=1',
    geometry: JSON.stringify({ xmin: minX, ymin: minY, xmax: maxX, ymax: maxY }),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: outFields,
    returnGeometry: 'true',
    f: 'json',
    resultRecordCount: 2000,  // ArcGIS limit
    ...extraParams
  })

  const url = `${serviceUrl}/query?${params.toString()}`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'casafari-mio/1.0' }
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()
    if (data.error) throw new Error(data.error.message)

    return data.features || []
  } catch (err) {
    console.error(`[arcgis-bbox] Error:`, err.message)
    return []
  }
}

/**
 * Limpiar caché (útil entre importaciones)
 */
export function clearCache() {
  Object.keys(ARCGIS_CACHE).forEach(key => delete ARCGIS_CACHE[key])
  console.log('[arcgis-query] Cache cleared')
}

/**
 * Estadísticas de caché
 */
export function getCacheStats() {
  return {
    entries: Object.keys(ARCGIS_CACHE).length,
    keys: Object.keys(ARCGIS_CACHE).slice(0, 10)  // Sample
  }
}
