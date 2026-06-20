// ─────────────────────────────────────────────────────────────────────────────
// Geocodificación de direcciones chilenas vía Nominatim/OpenStreetMap.
//
// Gratis, sin API key. Mismo proveedor que ya usa el proyecto hermano para
// España en `reference/smartbc/lib/geo/geocode.ts`. Policy de uso de Nominatim
// (https://operations.osmfoundation.org/policies/nominatim/): User-Agent
// identificable obligatorio + máximo ~1 req/s. Este módulo aplica un
// rate-limiter simple en memoria (single-process) para respetar esa policy;
// si el scraper corre en varios procesos en paralelo, el rate-limit real
// agregado podría superar 1 req/s — pendiente de coordinar con un limiter
// compartido (ej. vía Postgres o Redis) si eso llega a ser un problema real.
//
// Uso en la estrategia #2 de docs/research-portalinmobiliario-chile.md:
// geocodificar la dirección declarada del anuncio y comparar contra el pin
// lat/lng que puso el anunciante. Una discrepancia grande es la señal de
// "pin falso"; NO asumir que el geocoder es más confiable que el pin per se
// (la dirección declarada también puede ser referencial) — es una señal más
// a combinar, no un oráculo.
// ─────────────────────────────────────────────────────────────────────────────

const USER_AGENT = 'casafari-mio-scraper-cl/1.0 (contacto@casafari-mio.local)';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = 1100; // ~1 req/s con margen de seguridad

const TIMEOUT_MS = 8000;

let lastRequestAt = 0;
let queue = Promise.resolve();

/**
 * Serializa todas las llamadas a Nominatim de este proceso y espera el
 * intervalo mínimo entre una y la siguiente. No es un rate-limiter
 * distribuido — solo protege contra ráfagas dentro del mismo proceso Node.
 */
function scheduleNominatimCall(fn) {
  const run = async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  };
  const result = queue.then(run, run);
  // Evitar que un rechazo individual rompa la cola para llamadas futuras.
  queue = result.catch(() => {});
  return result;
}

async function nominatimSearch(query) {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=es&countrycodes=cl`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const hit = Array.isArray(data) ? data[0] : null;
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    // Red caída, timeout, JSON inválido, etc. — degradar a null, nunca lanzar.
    return null;
  }
}

/**
 * Geocodifica una dirección chilena (calle + comuna) a {lat, lng}.
 *
 * @param {object} params
 * @param {string|null} params.address - Dirección declarada (ej. "Av. Apoquindo 1234").
 * @param {string|null} params.comuna - Comuna (ej. "Las Condes"). Recomendado siempre
 *   que se conozca, porque el Rol SII y la desambiguación dependen de la comuna.
 * @param {string} [params.region] - Región opcional para reducir ambigüedad
 *   (ej. comunas de veraneo que se repiten en nombre, aunque es raro en Chile).
 * @returns {Promise<{lat:number, lng:number}|null>}
 */
export async function geocodeAddressCl({ address, comuna, region } = {}) {
  const parts = [];
  if (address) parts.push(address);
  if (comuna) parts.push(comuna);
  if (region) parts.push(region);
  parts.push('Chile');

  if (parts.length <= 1) return null; // sin address ni comuna no hay nada que geocodificar

  return scheduleNominatimCall(() => nominatimSearch(parts.join(', ')));
}

/**
 * Distancia haversine en metros entre dos puntos {lat, lng}.
 * @param {{lat:number, lng:number}} p1
 * @param {{lat:number, lng:number}} p2
 * @returns {number|null} - null si algún punto es inválido.
 */
export function distanceMeters(p1, p2) {
  if (!p1 || !p2) return null;
  const { lat: lat1, lng: lng1 } = p1;
  const { lat: lat2, lng: lng2 } = p2;
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;

  const R = 6371000; // radio terrestre medio en metros
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
