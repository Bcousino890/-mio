// Estimación de tiempos de viaje entre dos puntos en Madrid.
// Sin llamadas a API externas, 100% determinista: distancia en línea recta
// con factores empíricos por modo. Datos aproximados, marcados como tales
// en la UI. Para precisión real haría falta Google Distance Matrix.

const EARTH_RADIUS_KM = 6371;

/** Distancia en línea recta entre dos coordenadas (haversine), en km. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// Factores empíricos calibrados con muestras de rutas reales en Madrid
// (centro ↔ periferia, centro ↔ centro, periferia ↔ periferia).
// La fórmula es:
//   minutos = base + (km_lineales * factor_kmpm) + factor_walk
// Notas:
// - `factor_kmpm` representa min/km efectivos sobre la línea recta. Es
//   más alto que min/km de la ruta real porque incorpora el desvío
//   (índice de rodeo ~1.3 en ciudad).
// - `base` cubre tiempo fijo: encender el coche, esperar el metro,
//   estación → andén, etc.
// - `factor_walk` se suma para metro/bus: tiempo medio andando entre el
//   origen y la parada más cercana, y entre la parada de destino y el
//   destino final.

type ModeParams = {
  base: number;
  factorKmPerMin: number;
  walk: number;
  minMinutes: number;
};

const CAR: ModeParams = {
  base: 2,
  factorKmPerMin: 2.4, // ~25 km/h efectivos en Madrid con tráfico
  walk: 0,
  minMinutes: 5,
};

const METRO: ModeParams = {
  base: 6, // andar a la boca + esperar tren
  factorKmPerMin: 1.8, // metro a ~33 km/h real con paradas
  walk: 6, // andando entre paradas y destinos finales
  minMinutes: 12,
};

const BUS: ModeParams = {
  base: 5,
  factorKmPerMin: 2.6, // bus urbano lento, ~23 km/h en hora media
  walk: 5,
  minMinutes: 12,
};

function applyMode(distanceKm: number, mode: ModeParams): number {
  const raw = mode.base + distanceKm * mode.factorKmPerMin + mode.walk;
  return Math.max(mode.minMinutes, Math.round(raw));
}

export type EstimatedTimes = {
  distanceKm: number;
  car: number;
  metro: number;
  bus: number;
};

export function estimateTimes(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): EstimatedTimes {
  const distanceKm = haversineKm(fromLat, fromLng, toLat, toLng);
  return {
    distanceKm,
    car: applyMode(distanceKm, CAR),
    metro: applyMode(distanceKm, METRO),
    bus: applyMode(distanceKm, BUS),
  };
}
