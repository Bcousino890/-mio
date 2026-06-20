// ─────────────────────────────────────────────────────────────────────────────
// cadastre-cl.mjs — motor de catastro Chile (RC14-CL / RC20-CL)
// ─────────────────────────────────────────────────────────────────────────────
// CONSTRAINT LEGAL NO NEGOCIABLE (ver docs/RC-CHILE-INVESTIGACION.md):
//
//   Este módulo NUNCA debe hacer peticiones HTTP/scraping contra sii.cl,
//   www4.sii.cl/mapasui, zeus.sii.cl, ni ningún (sub)dominio del SII. Los
//   términos de uso de sii.cl prohíben expresamente: (a) captura/reproducción
//   automatizada de su sitio sin autorización, (b) cualquier uso COMERCIAL de
//   la información (el uso permitido declarado es "personal y no comercial"),
//   (c) redistribución/comercialización. El acceso programático vía WMS/WMTS
//   del SII está reservado por convenio SOLO a municipalidades (oficio +
//   resolución caso por caso) — casafari-mio (empresa privada) no califica.
//   Además: se confirmaron bloqueos HTTP 403 reales contra sii.cl, dominios de
//   arcgis.com relacionados, ciren.cl y baseapi.cl en pruebas previas.
//
//   El usuario confirmó explícitamente: "no podemos hablar con los del SII" —
//   no hay vía de partnership/convenio. La ÚNICA fuente de geometría
//   legalmente limpia para este módulo es IDE Chile / Geoportal.cl (SNIT),
//   que expone capas WMS/WFS estándar OGC sin restricciones de uso draconianas
//   (cobertura conocida: ~170/346 comunas vía la capa "Predios" del MINVU).
//
//   Si en el futuro alguien necesita el Rol de Avalúo exacto y la cobertura de
//   IDE Chile no alcanza, la vía es: (1) resolución manual por un humano caso
//   a caso, o (2) un proveedor de pago de terceros (ej. SimpleAPI/BaseAPI) que
//   asuma contractualmente ese riesgo — JAMÁS automatizar contra sii.cl desde
//   este código.
//
// Equivalencia con el motor español (0003_cadastre.sql / 0009_rc_resolution.sql):
//   rol_matriz (manzana-predio sin sub-rol) ≈ RC14
//   rol_unidad (sub-rol de copropiedad)     ≈ RC20
//
// NOTA DE INTEGRACIÓN: `findParcelByPoint(lat, lng)` es llamada por
// identity-resolution-cl.mjs (en desarrollo paralelo) con esta firma exacta.
// No cambiar nombre, orden de argumentos, ni forma del valor de retorno sin
// coordinar con ese módulo.
// ─────────────────────────────────────────────────────────────────────────────
import pg from 'pg'

const { Client } = pg

// ─── Configuración ───────────────────────────────────────────────────────────
// URL base del servicio WFS de IDE Chile/Geoportal (SNIT) — NO CONFIRMADA.
// TODO(spike de red real, fuera de este sandbox): confirmar
//   - el endpoint WFS exacto (¿geoportal.cl/geonetwork vía CSW + GetCapabilities
//     para descubrir la URL del servicio real, o hay una URL de servicio WFS
//     estable y documentada?),
//   - el nombre exacto de la capa "Predios" en GetCapabilities (puede no ser
//     literalmente 'Predios'; podría llevar prefijo de namespace, ej. 'minvu:Predios'
//     o un nombre versionado/por región),
//   - si el servicio requiere paginar por comuna/bbox (GetFeature con CQL_FILTER
//     o BBOX) o si solo permite descarga de capa completa,
//   - el sistema de coordenadas nativo de la capa (probablemente EPSG:32719
//     UTM 19S o EPSG:4326 — confirmar para saber si hace falta reproyectar antes
//     del INSERT, dado que cadastre_parcels_cl.geom es siempre SRID 4326),
//   - qué atributos trae cada feature (¿incluye el campo "rol" directamente, o
//     hay que cruzarlo con otra fuente?),
//   - rate limits / paginación (WFS típicamente usa maxFeatures o startIndex).
const DEFAULT_WFS_URL = process.env.IDE_CHILE_WFS_URL || null

/**
 * Ingesta una capa WFS de IDE Chile/Geoportal (SNIT) para una comuna dada y
 * la upsertea en `cadastre_parcels_cl`.
 *
 * Fuente exclusiva: IDE Chile / Geoportal.cl (WMS/WFS estándar OGC). Esta
 * función JAMÁS debe apuntar a un dominio sii.cl — ver banner legal arriba.
 *
 * @param {string} comunaCode - código de comuna (uso interno para filtrar o
 *   etiquetar la consulta; el filtro real por comuna en el WFS depende de
 *   cómo esté modelada la capa — ver TODOs arriba, no confirmado).
 * @param {object} [opts]
 * @param {string} [opts.layerName='Predios'] - nombre de la capa WFS (capa
 *   "Predios" publicada por MINVU vía el Grupo de Trabajo "Parcelas Catastrales").
 * @param {string} [opts.wfsUrl] - URL base del servicio WFS (por defecto,
 *   env var IDE_CHILE_WFS_URL).
 * @param {string} [opts.db_url] - connection string Postgres (por defecto,
 *   env var DATABASE_URL).
 * @returns {Promise<{ok: boolean, inserted?: number, updated?: number, error?: string}>}
 */
export async function ingestIdeChileLayer(comunaCode, { layerName = 'Predios', wfsUrl = DEFAULT_WFS_URL, db_url = process.env.DATABASE_URL } = {}) {
  if (!wfsUrl) {
    const msg = 'IDE_CHILE_WFS_URL no está configurada — ver TODO de spike de red en cabecera de este módulo'
    console.error(`[cadastre-cl] ${msg}`)
    return { ok: false, error: msg }
  }
  if (!db_url) {
    console.error('[cadastre-cl] DATABASE_URL no configurada')
    return { ok: false, error: 'DATABASE_URL required' }
  }

  // GetFeature estándar OGC WFS. Parámetros exactos (versión, nombre de capa
  // con/sin namespace, filtro por comuna) NO confirmados — ver TODO arriba.
  const url = `${wfsUrl}?service=WFS&version=2.0.0&request=GetFeature&typeName=${encodeURIComponent(layerName)}&outputFormat=application/json`

  let geojson
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) {
      const msg = `WFS respondió HTTP ${res.status} para capa '${layerName}' (comuna ${comunaCode})`
      console.error(`[cadastre-cl] ${msg}`)
      return { ok: false, error: msg }
    }
    geojson = await res.json()
  } catch (err) {
    console.error(`[cadastre-cl] error al consultar WFS IDE Chile: ${err.message}`)
    return { ok: false, error: err.message }
  }

  const features = Array.isArray(geojson?.features) ? geojson.features : []
  if (features.length === 0) {
    console.warn(`[cadastre-cl] capa '${layerName}' devolvió 0 features para comuna ${comunaCode}`)
    return { ok: true, inserted: 0, updated: 0 }
  }

  const client = new Client({ connectionString: db_url })
  try {
    await client.connect()

    // Resolver comuna_id: comunaCode aquí es el nombre o código que el
    // llamador use para localizar la fila en chile_comunas. Se intenta por
    // sii_comuna_code primero (si está poblado) y luego por nombre exacto.
    const comunaRes = await client.query(
      `SELECT id FROM chile_comunas WHERE sii_comuna_code = $1 OR name = $1 LIMIT 1`,
      [comunaCode]
    )
    const comunaId = comunaRes.rows[0]?.id
    if (!comunaId) {
      const msg = `comuna no encontrada en chile_comunas: ${comunaCode}`
      console.error(`[cadastre-cl] ${msg}`)
      return { ok: false, error: msg }
    }

    let inserted = 0
    let updated = 0

    for (const feature of features) {
      try {
        const geom = feature.geometry
        if (!geom) continue

        // El rol exacto puede no venir en los atributos de la capa MINVU
        // (Predios) — TODO confirmar con spike real qué propiedades trae.
        const rol = feature.properties?.rol ?? feature.properties?.ROL ?? null

        const result = await client.query(
          `
          INSERT INTO cadastre_parcels_cl (comuna_id, rol, source, geom, centroid, raw_attrs)
          VALUES (
            $1, $2, 'ide_chile',
            ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)),
            ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)),
            $4::jsonb
          )
          RETURNING id
          `,
          [comunaId, rol, JSON.stringify(geom), JSON.stringify(feature.properties ?? {})]
        )
        if (result.rows.length > 0) inserted++
      } catch (featErr) {
        console.error(`[cadastre-cl] error procesando feature: ${featErr.message}`)
      }
    }

    console.log(`[cadastre-cl] ingesta completa comuna=${comunaCode} capa=${layerName}: ${inserted} insertadas, ${updated} actualizadas`)
    return { ok: true, inserted, updated }
  } catch (err) {
    console.error(`[cadastre-cl] error de BD durante ingesta: ${err.message}`)
    return { ok: false, error: err.message }
  } finally {
    await client.end()
  }
}

/**
 * Busca la parcela catastral chilena que contiene un punto dado, vía
 * point-in-polygon (ST_Contains) contra `cadastre_parcels_cl`.
 *
 * FIRMA ESTABLE: llamada por identity-resolution-cl.mjs (módulo en desarrollo
 * paralelo) — no cambiar nombre/orden de argumentos/forma de retorno.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {object} [opts]
 * @param {string} [opts.db_url] - connection string Postgres (por defecto, env var DATABASE_URL).
 * @returns {Promise<object|null>} fila de cadastre_parcels_cl que contiene el punto, o null.
 */
export async function findParcelByPoint(lat, lng, { db_url = process.env.DATABASE_URL } = {}) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
    return null
  }
  if (!db_url) {
    console.error('[cadastre-cl] DATABASE_URL no configurada')
    return null
  }

  const client = new Client({ connectionString: db_url })
  try {
    await client.connect()
    const result = await client.query(
      `
      SELECT *
      FROM cadastre_parcels_cl
      WHERE geom IS NOT NULL
        AND ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
      LIMIT 1
      `,
      [lng, lat]
    )
    return result.rows[0] ?? null
  } catch (err) {
    console.error(`[cadastre-cl] error en findParcelByPoint: ${err.message}`)
    return null
  } finally {
    await client.end()
  }
}

// ─── Heurísticas de "pin sospechoso" ────────────────────────────────────────
// Sin DNPRC/RCCOOR no hay forma de validar contra el catastro oficial si el
// punto del anuncio es real o es solo el pin por defecto del centroide de la
// comuna (patrón común en portales chilenos cuando el anunciante no afina la
// ubicación). Estas heurísticas son señales de baja confianza, no verificación.

const EARTH_RADIUS_M = 6_371_000

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a))
}

/**
 * Detecta señales de que un pin de lat/lng es "sospechoso" (probablemente el
 * centroide por defecto de la comuna, o coordenadas redondeadas a mano) en
 * lugar de la ubicación real y precisa de la propiedad.
 *
 * @param {object} params
 * @param {number} params.lat
 * @param {number} params.lng
 * @param {{lat: number, lng: number}} [params.comunaCentroid] - centroide conocido de la comuna, si se tiene.
 * @param {number} [params.decimalPlaces=6] - nº de decimales esperado para una coordenada "precisa".
 * @returns {{suspicious: boolean, reasons: string[]}}
 */
export function detectSuspiciousPin({ lat, lng, comunaCentroid = null, decimalPlaces = 6 }) {
  const reasons = []

  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
    return { suspicious: true, reasons: ['coordenadas inválidas o ausentes'] }
  }

  // 1) Coincidencia con el centroide de la comuna dentro de ~50m: indicio
  //    fuerte de que el anuncio usa el pin genérico de la comuna, no la
  //    ubicación real de la propiedad.
  if (comunaCentroid && typeof comunaCentroid.lat === 'number' && typeof comunaCentroid.lng === 'number') {
    const dist = haversineMeters(lat, lng, comunaCentroid.lat, comunaCentroid.lng)
    if (dist <= 50) {
      reasons.push(`coincide con el centroide de la comuna (${dist.toFixed(1)} m)`)
    }
  }

  // 2) Decimales sospechosamente redondos: coordenadas truncadas a pocos
  //    decimales (ej. -33.45, -70.66) implican una precisión de cientos de
  //    metros — incompatible con un pin preciso de propiedad.
  const fractionalDigits = (n) => {
    const s = String(Math.abs(n))
    const dot = s.indexOf('.')
    return dot === -1 ? 0 : s.length - dot - 1
  }
  const latDigits = fractionalDigits(lat)
  const lngDigits = fractionalDigits(lng)
  if (latDigits < 4 || lngDigits < 4) {
    reasons.push(`coordenadas con pocos decimales (lat: ${latDigits}, lng: ${lngDigits} dígitos) — precisión insuficiente`)
  }

  // 3) Coordenadas que terminan en ceros (ej. .500000, .000000) — indicio de
  //    redondeo manual / pin colocado a ojo en lugar de GPS real.
  const trailingZeros = (n) => {
    const s = String(Math.abs(n))
    const dot = s.indexOf('.')
    if (dot === -1) return 0
    const frac = s.slice(dot + 1)
    const match = frac.match(/0+$/)
    return match ? match[0].length : 0
  }
  if (trailingZeros(lat) >= 3 || trailingZeros(lng) >= 3) {
    reasons.push('coordenadas terminan en múltiples ceros — posible redondeo manual')
  }

  // 4) Coordenadas idénticas en lat y lng más allá del signo (clásico typo /
  //    placeholder, ej. lat=lng en valor absoluto).
  if (Math.abs(lat) === Math.abs(lng) && lat !== 0 && lng !== 0) {
    reasons.push('lat y lng tienen el mismo valor absoluto — posible placeholder')
  }

  return { suspicious: reasons.length > 0, reasons }
}
