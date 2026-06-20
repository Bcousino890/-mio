// ─────────────────────────────────────────────────────────────────────────────
// Estrategia #6 (research-portalinmobiliario-chile.md): firma aérea/satelital
// como señal adicional de identidad para casas en zonas de alto valor (barrio
// alto de Santiago, Zapallar/Cachagua, Maitencillo, Pucón, Villarrica), donde
// es razonable esperar piscinas y huellas de techo distintivas visibles desde
// arriba.
//
// DISEÑO Y HONESTIDAD SOBRE VIABILIDAD (importante leer antes de tocar este
// archivo):
//
// 1. Detección de piscina (v1, implementada): threshold de color HSV sobre
//    los píxeles de una imagen satelital descargada. Es razonablemente viable
//    porque el turquesa/cian saturado de una piscina residencial es una firma
//    de color genuinamente atípica en el resto de una escena urbana/residencial
//    (techos, vegetación, calles, autos). Funciona mejor en casas grandes con
//    piscina visible y sin cobertura (lona, toldo, árboles) — exactamente el
//    perfil de las comunas mencionadas por el usuario. Limitaciones reales:
//    piscinas techadas o con cubierta de invierno no se detectan; piscinas de
//    plástico/inflables pequeñas dan falsos positivos; resolución/fecha de la
//    imagen satelital gratuita no está garantizada (puede ser de hace años).
//
// 2. Comparación de "huella de construcción" (ratio construcción/vegetación):
//    SE IMPLEMENTA como heurística burda (ratio de píxeles "no-verde" en el
//    radio fijo, ver `buildingFootprintRatio`), pero se documenta aquí
//    explícitamente como SEÑAL DÉBIL, no como reconocimiento de forma real.
//    Comparar dos ratios escalares entre el pin del anuncio y el centroide de
//    una parcela candidata NO es comparación de "forma de techo" en ningún
//    sentido geométrico — es, en el mejor caso, un proxy ruidoso de "¿hay
//    tanta construcción aquí como allá?". Cualquier mejora real (alineación
//    de huellas, segmentación de tejado, comparación de contornos) requeriría
//    visión por computador más pesada (ej. modelos de segmentación) que está
//    fuera de alcance de "esfuerzo razonable" para v1. Se deja anotado como
//    trabajo futuro en `compareAerialSignature` y NO se usa para subir el
//    score con la misma fuerza que la detección de piscina.
//
// 3. Proveedor de imagen: por defecto ESRI World Imagery (sin API key, REST
//    estándar de export). HALLAZGO ABIERTO (mismo cuidado legal que se aplicó
//    con SII en docs/RC-CHILE-INVESTIGACION.md): los términos de uso exactos
//    de ESRI World Imagery para consumo PROGRAMÁTICO Y COMERCIAL no se
//    confirmaron en esta sesión (no hay acceso de red al sandbox para leer
//    los ToS de ArcGIS Online en detalle). Antes de usar esto en producción a
//    escala, validar: (a) si el endpoint público de export tiene límites de
//    uso comercial, (b) si requiere atribución visible, (c) si hay rate-limit
//    documentado. El diseño es deliberadamente configurable
//    (`SATELLITE_TILE_PROVIDER` / `SATELLITE_TILE_URL`) para poder sustituir
//    por un proveedor de pago (Mapbox Satellite, Google Maps Static, Maxar)
//    sin tocar el resto del pipeline.
// ─────────────────────────────────────────────────────────────────────────────

import sharp from 'sharp';

const TIMEOUT_MS = 10000;

const PROVIDERS = {
  esri: {
    // ArcGIS REST "export" estándar — bbox en Web Mercator (EPSG:3857),
    // tamaño de imagen en píxeles, formato PNG.
    buildUrl: ({ bbox3857, widthPx, heightPx }) =>
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export' +
      `?bbox=${bbox3857.join(',')}` +
      '&bboxSR=3857&imageSR=3857' +
      `&size=${widthPx},${heightPx}` +
      '&format=png24&transparent=false&f=image',
  },
};

function getProviderConfig() {
  const name = process.env.SATELLITE_TILE_PROVIDER || 'esri';
  const customUrl = process.env.SATELLITE_TILE_URL;
  if (customUrl) {
    // Proveedor custom: se espera una URL con placeholders {minx} {miny} {maxx}
    // {maxy} {width} {height} ya en el sistema de coordenadas que ese
    // proveedor requiera. Quien configure SATELLITE_TILE_URL es responsable
    // de que el formato coincida con lo que su proveedor exige.
    return {
      name: name || 'custom',
      buildUrl: ({ bbox3857, widthPx, heightPx }) =>
        customUrl
          .replace('{minx}', bbox3857[0])
          .replace('{miny}', bbox3857[1])
          .replace('{maxx}', bbox3857[2])
          .replace('{maxy}', bbox3857[3])
          .replace('{width}', widthPx)
          .replace('{height}', heightPx),
    };
  }
  return { name, ...(PROVIDERS[name] || PROVIDERS.esri) };
}

// Conversión lat/lng (EPSG:4326) -> Web Mercator (EPSG:3857), necesaria para
// el bbox que pide el endpoint de ArcGIS.
function lngLatToMercator(lng, lat) {
  const R = 6378137;
  const x = (lng * Math.PI * R) / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

/**
 * Descarga una imagen satelital cuadrada centrada en {lat, lng}.
 *
 * @param {object} params
 * @param {number} params.lat
 * @param {number} params.lng
 * @param {number} [params.sizeM=60] - Lado del cuadrado en metros a capturar
 *   (60m por defecto: suficiente para cubrir una parcela residencial grande
 *   con margen, sin diluir tanto la piscina/techo en píxeles de vecinos).
 * @param {number} [params.pixels=256] - Resolución de la imagen descargada.
 * @returns {Promise<{ok:true, buffer:Buffer, provider:string}|{ok:false, reason:string}>}
 */
export async function fetchSatelliteImage({ lat, lng, sizeM = 60, pixels = 256 } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, reason: 'lat/lng inválidos' };
  }

  const provider = getProviderConfig();
  const [cx, cy] = lngLatToMercator(lng, lat);
  const half = sizeM / 2;
  const bbox3857 = [cx - half, cy - half, cx + half, cy + half];

  const url = provider.buildUrl({ bbox3857, widthPx: pixels, heightPx: pixels });

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'casafari-mio-scraper-cl/1.0 (contacto@casafari-mio.local)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status} de proveedor ${provider.name}` };
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0) {
      return { ok: false, reason: 'respuesta vacía' };
    }
    return { ok: true, buffer, provider: provider.name };
  } catch (err) {
    return { ok: false, reason: `error de red/timeout: ${err.message || err}` };
  }
}

// Convierte RGB (0-255) a HSV. Devuelve {h: 0-360, s: 0-1, v: 0-1}.
function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return { h, s, v };
}

// Umbral de color para "piscina": cian/turquesa saturado y brillante.
// Rango de hue ~160-220 cubre turquesa hasta azul piscina; se exige
// saturación y valor altos para evitar confundir con cielo nublado, sombras
// azuladas o techos de zinc/metal azul (que suelen ser menos saturados).
const POOL_HUE_MIN = 160;
const POOL_HUE_MAX = 225;
const POOL_SAT_MIN = 0.35;
const POOL_VAL_MIN = 0.35;

/**
 * Detecta presencia de piscina en una imagen aérea mediante threshold de
 * color HSV (turquesa/cian saturado). No usa ML — es un detector de firma de
 * color simple, adecuado como señal débil-a-moderada, no como prueba.
 *
 * @param {Buffer} imageBuffer
 * @returns {Promise<{hasPool:boolean, confidence:number, poolPixelRatio:number}|{hasPool:false, confidence:0, error:string}>}
 */
export async function detectPool(imageBuffer) {
  if (!imageBuffer || imageBuffer.length === 0) {
    return { hasPool: false, confidence: 0, error: 'buffer vacío' };
  }

  try {
    const { data, info } = await sharp(imageBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    const totalPixels = width * height;
    if (totalPixels === 0) {
      return { hasPool: false, confidence: 0, error: 'imagen sin píxeles' };
    }

    let poolPixels = 0;
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const { h, s, v } = rgbToHsv(r, g, b);
      if (h >= POOL_HUE_MIN && h <= POOL_HUE_MAX && s >= POOL_SAT_MIN && v >= POOL_VAL_MIN) {
        poolPixels++;
      }
    }

    const poolPixelRatio = poolPixels / totalPixels;

    // Una piscina residencial mínima ocupa un % perceptible del recorte
    // (sizeM=60 por defecto). Umbral conservador para evitar falsos
    // positivos de un solo píxel de ruido; aún así puede confundir con otras
    // superficies de agua (estanques decorativos) — limitación conocida.
    const POOL_MIN_RATIO = 0.004; // ~0.4% del área del recorte
    const hasPool = poolPixelRatio >= POOL_MIN_RATIO;

    // Confianza cruda: escala el ratio observado contra un ratio "típico" de
    // piscina doméstica (~3% del recorte de 60x60m), capada a 1.
    const TYPICAL_POOL_RATIO = 0.03;
    const confidence = hasPool ? Math.min(1, poolPixelRatio / TYPICAL_POOL_RATIO) : 0;

    return { hasPool, confidence, poolPixelRatio };
  } catch (err) {
    return { hasPool: false, confidence: 0, error: `error decodificando imagen: ${err.message || err}` };
  }
}

// Heurística burda de "huella de construcción": ratio de píxeles que NO son
// vegetación/suelo desnudo (verde dominante o tierra/marrón) sobre el total.
// Ver advertencia en la cabecera del archivo: esto NO es comparación de
// forma de techo, es un proxy escalar ruidoso. Útil solo como señal muy débil
// adicional, nunca como confirmación.
function rgbToHsvPixel(r, g, b) {
  return rgbToHsv(r, g, b);
}

async function buildingFootprintRatio(imageBuffer) {
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const totalPixels = width * height;
  if (totalPixels === 0) return null;

  let vegetationOrBare = 0;
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const { h, s, v } = rgbToHsvPixel(r, g, b);
    // Verde vegetación: hue ~70-160. Tierra/suelo desnudo: baja saturación,
    // tonos marrones (hue ~10-50 con saturación baja-media).
    const isGreenVegetation = h >= 70 && h <= 160 && s >= 0.15;
    const isBareSoil = h >= 10 && h <= 50 && s < 0.45 && v > 0.2 && v < 0.85;
    if (isGreenVegetation || isBareSoil) vegetationOrBare++;
  }

  return 1 - vegetationOrBare / totalPixels; // ratio "construcción/otro"
}

/**
 * Compara la firma aérea del pin del anuncio contra el centroide de una
 * parcela candidata (típicamente el resultado de `findParcelByPoint` de la
 * estrategia #3, ver identity-resolution-cl.mjs).
 *
 * @param {{lat:number, lng:number}} listingLatLng - Pin declarado del anuncio.
 * @param {{lat:number, lng:number}} candidateParcelCentroid - Centroide de la
 *   parcela candidata.
 * @param {object} [opts]
 * @param {number} [opts.sizeM=60]
 * @returns {Promise<{
 *   pool_match: boolean|null,
 *   signal_strength: number,
 *   listing_pool: object|null,
 *   candidate_pool: object|null,
 *   footprint_ratio_diff: number|null,
 *   provider_errors: string[]
 * }>}
 */
export async function compareAerialSignature(listingLatLng, candidateParcelCentroid, opts = {}) {
  const sizeM = opts.sizeM ?? 60;
  const providerErrors = [];

  if (!listingLatLng || !candidateParcelCentroid) {
    return {
      pool_match: null,
      signal_strength: 0,
      listing_pool: null,
      candidate_pool: null,
      footprint_ratio_diff: null,
      provider_errors: ['falta lat/lng del anuncio o centroide de parcela candidata'],
    };
  }

  const [listingImg, candidateImg] = await Promise.all([
    fetchSatelliteImage({ lat: listingLatLng.lat, lng: listingLatLng.lng, sizeM }),
    fetchSatelliteImage({ lat: candidateParcelCentroid.lat, lng: candidateParcelCentroid.lng, sizeM }),
  ]);

  if (!listingImg.ok) providerErrors.push(`listing: ${listingImg.reason}`);
  if (!candidateImg.ok) providerErrors.push(`candidate: ${candidateImg.reason}`);

  if (!listingImg.ok || !candidateImg.ok) {
    return {
      pool_match: null,
      signal_strength: 0,
      listing_pool: null,
      candidate_pool: null,
      footprint_ratio_diff: null,
      provider_errors: providerErrors,
    };
  }

  const [listingPool, candidatePool] = await Promise.all([
    detectPool(listingImg.buffer),
    detectPool(candidateImg.buffer),
  ]);

  let footprintRatioDiff = null;
  try {
    const [listingFootprint, candidateFootprint] = await Promise.all([
      buildingFootprintRatio(listingImg.buffer),
      buildingFootprintRatio(candidateImg.buffer),
    ]);
    if (listingFootprint !== null && candidateFootprint !== null) {
      footprintRatioDiff = Math.abs(listingFootprint - candidateFootprint);
    }
  } catch (err) {
    providerErrors.push(`footprint heuristic: ${err.message || err}`);
  }

  // pool_match: true si ambos puntos coinciden en tener/no tener piscina
  // detectada; null si alguna detección falló por error de imagen.
  let poolMatch = null;
  if (!listingPool.error && !candidatePool.error) {
    poolMatch = listingPool.hasPool === candidatePool.hasPool;
  }

  // signal_strength (0..1): combina coincidencia de piscina (señal moderada,
  // pondera fuerte cuando AMBOS tienen piscina detectada — coincidencia de
  // ausencia es mucho menos informativa porque la mayoría de puntos no
  // tienen piscina) con la huella de construcción (señal débil, peso bajo).
  let signalStrength = 0;
  if (poolMatch === true && listingPool.hasPool && candidatePool.hasPool) {
    signalStrength += 0.7 * Math.min(listingPool.confidence, candidatePool.confidence);
  } else if (poolMatch === false) {
    // Una discrepancia clara (uno tiene piscina detectada, el otro no) es
    // evidencia débil EN CONTRA del match — no es definitivo (piscina nueva,
    // imagen vieja, piscina cubierta), pero se resta algo.
    signalStrength -= 0.15;
  }
  if (footprintRatioDiff !== null) {
    // Diferencia pequeña de ratio construcción/vegetación = leve refuerzo;
    // diferencia grande = leve penalización. Señal deliberadamente débil
    // (factor 0.1) por las limitaciones documentadas arriba.
    signalStrength += 0.1 * (1 - Math.min(1, footprintRatioDiff * 3));
  }
  signalStrength = Math.max(-1, Math.min(1, signalStrength));

  return {
    pool_match: poolMatch,
    signal_strength: signalStrength,
    listing_pool: listingPool,
    candidate_pool: candidatePool,
    footprint_ratio_diff: footprintRatioDiff,
    provider_errors: providerErrors,
  };
}
