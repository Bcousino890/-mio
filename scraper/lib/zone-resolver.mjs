// ─────────────────────────────────────────────────────────────────────────────
// zone-resolver.mjs
//
// Resuelve zone_raw (ej: 'madrid/chamberi/almagro') a:
//   - district_id (UUID del distrito: Chamberí)
//   - zone_id (UUID de la zona: Almagro en Chamberí)
//   - subzone_id (UUID de la subzona, si aplica)
//
// USO EN EL SCRAPER:
//   const resolved = await resolveZone(dbClient, zoneSlug, optionalZoneRaw)
//   -> { district_id, zone_id, subzone_id }
//
// NOTAS:
//   - zoneSlug es el idealista_slug que pasamos al scraper (ej: madrid/barrio-de-salamanca)
//   - zone_raw es el texto libre que viene en el HTML del anuncio (ej: 'Barrio de Salamanca')
//   - Ambos se usan para maximizar confianza de resolución
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resuelve un slug de Idealista o un nombre de zona crudo a IDs normalizados.
 *
 * @param {pg.Client} client - Conexión a BD Postgres
 * @param {string} idealista_slug - Slug de Idealista (ej: 'madrid/barrio-de-salamanca/goya')
 * @param {string} zone_raw - Nombre de zona crudo del HTML (ej: 'Barrio de Salamanca')
 * @returns {Promise<{district_id, zone_id, subzone_id}>}
 */
export async function resolveZone(client, idealista_slug, zone_raw = null) {
  if (!idealista_slug) {
    return { district_id: null, zone_id: null, subzone_id: null }
  }

  // Parsear el slug de Idealista: 'madrid/chamberi' o 'madrid/chamberi/almagro'
  const parts = idealista_slug.split('/').filter(Boolean)
  if (parts.length < 2) {
    // No hay zona, solo municipio
    return { district_id: null, zone_id: null, subzone_id: null }
  }

  // El segundo nivel es el slug del distrito
  const districtSlug = parts[1]

  // El tercer nivel (si existe) es la zona o subzona
  const subslug = parts[2] || null

  // ──────────────────────────────────────────────────────────────────────────
  // PASO 1: Resolver el DISTRITO
  // ──────────────────────────────────────────────────────────────────────────
  const districtQuery = `
    SELECT id FROM districts
    WHERE slug = $1
    LIMIT 1
  `
  const districtResult = await client.query(districtQuery, [districtSlug])
  const district_id = districtResult.rows[0]?.id || null

  if (!district_id) {
    console.warn(`[zone-resolver] Distrito no encontrado: ${districtSlug}`)
    return { district_id: null, zone_id: null, subzone_id: null }
  }

  // Si no hay subslug, todo queda en el distrito (no hay zona específica)
  if (!subslug) {
    return { district_id, zone_id: null, subzone_id: null }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PASO 2: Resolver la ZONA
  // ──────────────────────────────────────────────────────────────────────────
  const zoneQuery = `
    SELECT id FROM zones
    WHERE district_id = $1 AND slug = $2
    LIMIT 1
  `
  const zoneResult = await client.query(zoneQuery, [district_id, subslug])
  const zone_id = zoneResult.rows[0]?.id || null

  if (!zone_id) {
    // Es posible que 'subslug' sea en realidad el nombre de la zona que buscamos.
    // Intentar búsqueda más flexible (por nombre, no slug exacto)
    const zoneFlexQuery = `
      SELECT id FROM zones
      WHERE district_id = $1 AND slug ILIKE $2
      LIMIT 1
    `
    const zoneFlexResult = await client.query(zoneFlexQuery, [district_id, `%${subslug}%`])
    if (!zoneFlexResult.rows[0]) {
      console.warn(`[zone-resolver] Zona no encontrada: ${subslug} en distrito ${districtSlug}`)
      return { district_id, zone_id: null, subzone_id: null }
    }
    // Usamos la zona encontrada por búsqueda flexible
    const zone_id_found = zoneFlexResult.rows[0].id
    return {
      district_id,
      zone_id: zone_id_found,
      subzone_id: null
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PASO 3: Resolver la SUBZONA (si existe)
  // ──────────────────────────────────────────────────────────────────────────
  // Si zone_raw tiene menciones de subnombres, intentar resolver subzona
  let subzone_id = null
  if (zone_raw) {
    const subzoneQuery = `
      SELECT id FROM subzones
      WHERE zone_id = $1 AND slug ILIKE $2
      LIMIT 1
    `
    // Limpiar zone_raw: pasar a minúsculas, quitar acentos, hífenes
    const cleanZoneRaw = zone_raw
      .toLowerCase()
      .replace(/[áéíóú]/g, (c) => ({ á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' }[c]))
      .replace(/\s+/g, '-')

    const subzoneResult = await client.query(subzoneQuery, [zone_id, `%${cleanZoneRaw}%`])
    subzone_id = subzoneResult.rows[0]?.id || null
  }

  return { district_id, zone_id, subzone_id }
}


/**
 * Cache en memoria para evitar queries repetidas (opcional, para scraper rápido)
 * Usar si el scraper repite muchas zonas.
 */
export class ZoneResolverCache {
  constructor() {
    this.cache = new Map()
  }

  key(idealista_slug, zone_raw) {
    return `${idealista_slug}|${zone_raw || ''}`
  }

  get(idealista_slug, zone_raw) {
    return this.cache.get(this.key(idealista_slug, zone_raw))
  }

  set(idealista_slug, zone_raw, result) {
    this.cache.set(this.key(idealista_slug, zone_raw), result)
  }

  async resolveWithCache(client, idealista_slug, zone_raw) {
    const cached = this.get(idealista_slug, zone_raw)
    if (cached) {
      return cached
    }
    const result = await resolveZone(client, idealista_slug, zone_raw)
    this.set(idealista_slug, zone_raw, result)
    return result
  }

  clear() {
    this.cache.clear()
  }
}
