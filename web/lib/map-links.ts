// Enlaces externos a servicios de mapas que no requieren API key.

/**
 * Google Earth web centrado en el punto: patrón search + cámara (igual que
 * los enlaces que genera el propio Earth), vuela al punto y deja la cámara
 * a ~800 m con vista cenital. Gratis, sin API.
 */
export function googleEarthUrl(lat: number, lng: number): string {
  return `https://earth.google.com/web/search/${lat},${lng}/@${lat},${lng},700a,800d,35y,0h,0t,0r`
}

/** Google Maps centrado en el punto. */
export function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/${lat},${lng}`
}
