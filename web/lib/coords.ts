/**
 * Coordenadas que llegan del API y hay que tratar como NÚMEROS.
 *
 * `property_cl.latitude/longitude` y `manual_latitude/manual_longitude` son
 * columnas `numeric`, y el driver de Postgres devuelve `numeric` como STRING
 * para no perder precisión. La ficha las usa como números
 * (`manualPin.latitude.toFixed(5)`, el marcador de Leaflet, el enlace a Google
 * Maps), así que un valor sin castear no daba un dato feo: reventaba el render
 * y con él la app entera —la pantalla negra de "Application error"— al abrir
 * cualquier propiedad con pin guardado, es decir, cualquiera ya captada.
 *
 * El cast correcto va en el SQL (ver /api/chile/property-cl). Esto es el cinturón
 * de seguridad del lado del cliente: normaliza venga como venga.
 *
 * Módulo sin dependencias a propósito: lo importan componentes cliente.
 */

/** Número real, venga como número o como string. null si falta o no es válido. */
export function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Par lat/lng listo para usar, o null si a alguno le falta un valor válido. */
export function toLatLng(lat: unknown, lng: unknown): { latitude: number; longitude: number } | null {
  const latitude = toNum(lat)
  const longitude = toNum(lng)
  return latitude != null && longitude != null ? { latitude, longitude } : null
}
