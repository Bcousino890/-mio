import type { CheerioAPI } from "cheerio";
import type { ImportPreview } from "../types";
import {
  isIdealistaImageUrl,
  toIdealistaHighQuality,
} from "../../scrapers/idealista";
import { PhotoCollector } from "../../scrapers/image-utils";
import {
  externalIdFromUrl,
  findJsonLdByType,
  firstText,
  getMeta,
  parseAreaString,
  parseBathrooms,
  parseBedrooms,
  parsePriceString,
} from "../parse-utils";
import { detectAdvertiserFromHtml, fetchIdealistaPhoneViaAjax } from "../../particulares/idealista-advertiser-detector";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos que refleja el JSON embebido de Idealista. Basado en el schema real de
// la API de Idealista (y del HTML embebido). Campos opcionales porque no todos
// los listados los incluyen.
// ─────────────────────────────────────────────────────────────────────────────
type IdealistaListing = {
  propertyCode?: string;
  externalReference?: string;
  price?: number;
  priceInfo?: { price?: { amount?: number } };
  size?: number;
  rooms?: number;
  bathrooms?: number;
  operation?: string;
  propertyType?: string;
  address?: string;
  province?: string;
  municipality?: string;
  district?: string;
  latitude?: number;
  longitude?: number;
  // Idealista anida a veces las coordenadas bajo `ubication`.
  ubication?: { latitude?: number; longitude?: number };
  floor?: string;
  exterior?: boolean;
  hasLift?: boolean;
  description?: string;
  url?: string;
  suggestedTexts?: { title?: string; subtitle?: string };
  multimedia?: {
    images?: Array<{ url?: string; tag?: string }>;
    virtual3DTours?: unknown[];
  };
  features?: {
    hasSwimmingPool?: boolean;
    hasTerrace?: boolean;
    hasAirConditioning?: boolean;
    hasBoxRoom?: boolean;
    hasGarden?: boolean;
  };
  parkingSpace?: {
    hasParkingSpace?: boolean;
    isParkingSpaceIncludedInPrice?: boolean;
  };
  detailedType?: { typology?: string };
};

// ─────────────────────────────────────────────────────────────────────────────
// Busca el JSON de la ficha embebido en los <script> inline de la página.
// Idealista inyecta window.listingPageData / window.adData / initialProps / etc.
// con el objeto completo de la propiedad. Si no lo encuentra, devuelve null y
// el extractor cae a los selectores DOM.
// ─────────────────────────────────────────────────────────────────────────────
function findEmbeddedListing($: CheerioAPI): IdealistaListing | null {
  const scripts: string[] = [];
  $("script:not([src])").each((_, el) => {
    const txt = $(el).contents().text();
    if (txt && txt.includes("propertyCode") && txt.includes("multimedia")) {
      scripts.push(txt);
    }
  });

  for (const src of scripts) {
    // Intenta extraer el primer objeto JSON que contenga `propertyCode`.
    // Buscamos el patrón `{"propertyCode"` o `{...,"propertyCode":` y tomamos
    // el JSON completo que empieza ahí.
    const startIdx = src.indexOf('"propertyCode"');
    if (startIdx === -1) continue;

    // Retrocede hasta encontrar la `{` de apertura del objeto.
    let objStart = startIdx;
    while (objStart > 0 && src[objStart] !== "{") objStart--;
    if (objStart < 0) continue;

    // Avanza buscando el `}` de cierre equilibrado.
    let depth = 0;
    let objEnd = objStart;
    for (let i = objStart; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) {
          objEnd = i;
          break;
        }
      }
    }
    if (objEnd === objStart) continue;

    try {
      const obj = JSON.parse(src.slice(objStart, objEnd + 1));
      if (obj && typeof obj.propertyCode === "string") return obj as IdealistaListing;
    } catch {
      // JSON malformado — seguimos buscando en el siguiente script.
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapea el objeto de listing al shape de ImportPreview.
// ─────────────────────────────────────────────────────────────────────────────
function listingToPreview(
  listing: IdealistaListing,
  sourceUrl: string,
): ImportPreview {
  const warnings: string[] = [];

  const price =
    listing.price ??
    listing.priceInfo?.price?.amount ??
    null;

  const title =
    listing.suggestedTexts?.title ??
    null;

  const description = listing.description ?? null;

  // Zona: lo más específico primero (distrito > municipio > provincia).
  // Ej.: en Madrid capital queremos "Retiro", no "Madrid".
  const zone = listing.district ?? listing.municipality ?? listing.province ?? null;
  const addressParts = [listing.address, listing.municipality, listing.province].filter(Boolean);
  const address = addressParts.length ? addressParts.join(", ") : null;

  const operation = listing.operation === "rent" ? "rent" : "sale";

  // Fotos: `multimedia.images[].url` en formato WEB_LISTING-M → upgrade a
  // WEB_DETAIL_TOP-XL-L con el helper del scraper de imágenes.
  const collector = new PhotoCollector();
  for (const img of listing.multimedia?.images ?? []) {
    if (!img.url) continue;
    if (!isIdealistaImageUrl(img.url)) continue;
    collector.add(toIdealistaHighQuality(img.url), img.tag ?? undefined);
  }
  const photos = collector.toArray();

  // Features: combina booleanos del objeto `features` + campos raíz.
  const featureSet = new Set<string>();
  const f = listing.features;
  if (f) {
    if (f.hasAirConditioning) featureSet.add("Aire acondicionado");
    if (f.hasTerrace) featureSet.add("Terraza");
    if (f.hasSwimmingPool) featureSet.add("Piscina");
    if (f.hasBoxRoom) featureSet.add("Trastero");
    if (f.hasGarden) featureSet.add("Jardín");
  }
  if (listing.hasLift) featureSet.add("Ascensor");
  if (listing.exterior) featureSet.add("Exterior");
  if (listing.parkingSpace?.hasParkingSpace) featureSet.add("Garaje");

  // Atributos adicionales (sin campo directo en NormalizedProperty).
  const rawAttributes: Record<string, string | number | null> = {};
  if (listing.floor) rawAttributes["Planta"] = listing.floor;
  if (listing.detailedType?.typology) rawAttributes["Tipología"] = listing.detailedType.typology;
  if (listing.propertyCode) rawAttributes["propertyCode"] = listing.propertyCode;
  if (listing.externalReference) rawAttributes["externalReference"] = listing.externalReference;
  if (listing.latitude) rawAttributes["latitude"] = listing.latitude;
  if (listing.longitude) rawAttributes["longitude"] = listing.longitude;
  if (listing.parkingSpace?.isParkingSpaceIncludedInPrice != null)
    rawAttributes["garagePriceIncluded"] = String(listing.parkingSpace.isParkingSpaceIncludedInPrice);

  if (!title) warnings.push("título no detectado");
  if (price === null) warnings.push("precio no detectado");
  if (photos.length === 0)
    warnings.push("sin fotos en multimedia.images — puede ser listado de prueba o sin galería");

  return {
    portal: "idealista",
    sourceUrl,
    externalReference: listing.propertyCode
      ? `idealista-${listing.propertyCode}`
      : externalIdFromUrl("idealista", sourceUrl),
    title,
    description,
    operation,
    stay: null,
    price,
    currency: "EUR",
    bedrooms: listing.rooms ?? null,
    bathrooms: listing.bathrooms ?? null,
    squareMeters: listing.size ?? null,
    zone,
    address,
    features: Array.from(featureSet),
    latitude: typeof listing.latitude === "number" ? listing.latitude : null,
    longitude: typeof listing.longitude === "number" ? listing.longitude : null,
    photos,
    rawAttributes,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback: sin JSON embebido → DOM / og:meta / JSON-LD.
// ─────────────────────────────────────────────────────────────────────────────
function extractFromDom($: CheerioAPI, sourceUrl: string): ImportPreview {
  const warnings: string[] = [
    "JSON embebido no encontrado — extrayendo de DOM (menos preciso)",
  ];

  const ogTitle = getMeta($, "og:title");
  const ogDesc = getMeta($, "og:description");

  const title =
    firstText($, [".main-info__title-main", "h1.main-info__title"]) ??
    ogTitle ??
    null;
  const description =
    firstText($, [".comment p", ".comment", "[data-comment]"]) ??
    ogDesc ??
    null;

  let price: number | null = null;
  let currency: string | null = null;
  const priceText = firstText($, [".info-data-price", ".price", ".info-features__price"]);
  if (priceText) {
    price = parsePriceString(priceText);
    if (/€/.test(priceText)) currency = "EUR";
  }
  if (price === null) {
    const metaPrice = getMeta($, "product:price:amount");
    if (metaPrice) price = parsePriceString(metaPrice);
    currency = currency ?? getMeta($, "product:price:currency");
  }
  if (price === null) {
    const ld = findJsonLdByType($, ["Product"]);
    if (ld && typeof ld.offers === "object" && ld.offers) {
      const o = ld.offers as Record<string, unknown>;
      const p = typeof o.price === "number" || typeof o.price === "string" ? String(o.price) : null;
      price = parsePriceString(p);
      if (typeof o.priceCurrency === "string") currency = o.priceCurrency;
    }
  }

  const detailsText = $(".info-features").text();
  // Fallback amplio: texto completo del body para buscar m²/habs/baños
  // cuando los selectores específicos no existen (caso típico del HTML
  // archivado por Wayback, que es SSR sin la hidratación React completa).
  const bodyText = $("body").text();

  const squareMeters =
    parseAreaString(detailsText) ??
    parseAreaString(description ?? "") ??
    parseAreaString(title ?? "") ??
    parseAreaString(bodyText);
  const bedrooms =
    parseBedrooms(detailsText) ??
    parseBedrooms(description ?? "") ??
    parseBedrooms(bodyText);
  const bathrooms =
    parseBathrooms(detailsText) ??
    parseBathrooms(description ?? "") ??
    parseBathrooms(bodyText);

  const addressLine = firstText($, [
    ".main-info__title-minor",
    "#headerMap",
    ".location-data",
  ]);
  const address = addressLine ?? null;
  const zone = addressLine ? (addressLine.split(",")[0]?.trim() ?? null) : null;

  // Detección de operación. La URL `/inmueble/<id>/` es la misma para
  // alquiler y venta, así que NO es buen indicador. Mejor mirar el texto
  // visible: el título y el og:description suelen empezar con "Alquiler de
  // piso..." o "Venta de piso..." según corresponda. Como último recurso,
  // un precio en "€/mes" indica alquiler.
  let operation: "rent" | "sale" | null = null;
  const operationCorpus = [title, description, ogTitle, ogDesc, priceText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/\balquile[rt]\b|\barrendam|€\s*\/\s*mes|\beur\s*\/\s*mes/i.test(operationCorpus)) {
    operation = "rent";
  } else if (/\bventa\b|\bcompra\b|\bvende\b|\ben venta\b/i.test(operationCorpus)) {
    operation = "sale";
  } else if (/\/alquiler-/i.test(sourceUrl)) {
    operation = "rent";
  } else if (/\/venta-/i.test(sourceUrl)) {
    operation = "sale";
  }

  const featureSet = new Set<string>();
  $(".details-property_features li, .details-property-feature li").each((_, el) => {
    const txt = $(el).text().trim();
    if (txt) featureSet.add(txt);
  });

  // Fotos via CDN (scraper de imágenes).
  const collector = new PhotoCollector();
  $("img").each((_, el) => {
    const $el = $(el);
    const candidates = [
      $el.attr("data-original"),
      $el.attr("data-src"),
      $el.attr("src"),
    ];
    for (const c of candidates) {
      if (!c) continue;
      if (isIdealistaImageUrl(c)) {
        collector.add(toIdealistaHighQuality(c), $el.attr("alt"));
        break;
      }
    }
  });
  $("source").each((_, el) => {
    const srcset = $(el).attr("srcset") ?? "";
    for (const part of srcset.split(",")) {
      const u = part.trim().split(/\s+/)[0];
      if (u && isIdealistaImageUrl(u)) collector.add(toIdealistaHighQuality(u));
    }
  });

  // Fallback adicional: cuando el HTML viene de Wayback Machine, las fotos
  // del slider no están en <img>/<source> sino en una variable JS inline
  // `multimediaCarrousel: { multimedias: [...] }`. Extraemos las URLs
  // `img\d+.idealista.com/blur/...` con un regex sobre el HTML raw.
  const rawHtml = $.html();
  if (/multimediaCarrousel/.test(rawHtml)) {
    const carrouselRe =
      /https?:\/\/img\d*\.idealista\.com\/blur\/[A-Z_-]+\/[^"'\s)>]+\.(?:jpe?g|webp|png)/gi;
    let m: RegExpExecArray | null;
    while ((m = carrouselRe.exec(rawHtml)) !== null) {
      const u = m[0];
      if (isIdealistaImageUrl(u)) collector.add(toIdealistaHighQuality(u));
    }
  }

  const photos = collector.toArray();

  if (!title) warnings.push("título no detectado");
  if (price === null) warnings.push("precio no detectado");
  if (photos.length === 0)
    warnings.push("sin fotos — Idealista puede haber servido captcha o bloqueo");

  return {
    portal: "idealista",
    sourceUrl,
    externalReference: externalIdFromUrl("idealista", sourceUrl),
    title,
    description,
    operation,
    stay: null,
    price,
    currency: currency ?? "EUR",
    bedrooms,
    bathrooms,
    squareMeters,
    zone,
    address,
    features: Array.from(featureSet),
    latitude: null,
    longitude: null,
    photos,
    rawAttributes: {},
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Multimedia extra: plano y vídeo de la ficha.
// ─────────────────────────────────────────────────────────────────────────────

// Plano: Idealista lo sirve como imagen de la galería con alt/title
// "Imagen Plano de piso en …" (o tag "plan" en multimedia.images del JSON
// embebido). Capturamos la URL en alta calidad.
function extractFloorPlanUrl(
  $: CheerioAPI,
  embedded: IdealistaListing | null,
): string | null {
  // 1) JSON embebido: imágenes con tag de plano.
  for (const img of embedded?.multimedia?.images ?? []) {
    if (!img.url || !img.tag) continue;
    if (/^plan/i.test(img.tag) || /plano/i.test(img.tag)) {
      if (isIdealistaImageUrl(img.url)) return toIdealistaHighQuality(img.url);
    }
  }

  // 2) DOM: <img alt="Imagen Plano de…"> o title="…Plano…". La URL real
  //    puede estar en src o data-service (lazy load).
  let found: string | null = null;
  $("img").each((_, el) => {
    if (found) return;
    const $el = $(el);
    const label = `${$el.attr("alt") ?? ""} ${$el.attr("title") ?? ""}`;
    if (!/\bplano\b/i.test(label)) return;
    const candidates = [
      $el.attr("src"),
      $el.attr("data-service"),
      $el.attr("data-src"),
      $el.attr("data-original"),
    ];
    for (const c of candidates) {
      if (c && isIdealistaImageUrl(c)) {
        found = toIdealistaHighQuality(c);
        return;
      }
    }
  });
  return found;
}

// Vídeo: <video><source src="https://stXv.idealista.com/.../hd_XXX.mp4">.
// Preferimos la variante HD (media min-width) si existe; si no, la primera.
function extractVideoUrl($: CheerioAPI): string | null {
  let hd: string | null = null;
  let any: string | null = null;
  $("video source").each((_, el) => {
    const src = $(el).attr("src");
    if (!src || !/\.mp4(\?|$)/i.test(src)) return;
    if (!any) any = src;
    if (!hd && $(el).attr("media")) hd = src;
  });
  if (hd || any) return hd ?? any;

  // Fallback: URL de vídeo del CDN de Idealista en el HTML raw (por si el
  // <video> se monta por JS y solo está la URL inline).
  const m = $.html().match(
    /https?:\/\/st\d*v\.idealista\.com\/[^\s"'<>]+\.mp4/i,
  );
  return m?.[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ubicación precisa: coordenadas + dirección exacta (calle + número).
//
// Idealista marca en el portal solo la ZONA (p.ej. "Retiro") cuando el
// anunciante oculta la dirección, pero casi siempre embebe unas coordenadas
// (el centro del mapa de la ficha) que son MUCHO más cercanas al piso real
// que el centro del distrito. Y cuando el anunciante muestra la dirección
// completa, esta aparece en el título ("Piso en venta en Calle X, 81") y en
// el bloque de ubicación. Extraemos ambas cosas para clavar el puntito.
// ─────────────────────────────────────────────────────────────────────────────

// Coordenadas válidas dentro de España (incluye Canarias y Baleares).
function isSpainCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= 27 &&
    lat <= 44 &&
    lng >= -19 &&
    lng <= 5 &&
    // Descartar 0,0 y valores triviales.
    Math.abs(lat) > 0.01
  );
}

// Escanea el HTML crudo buscando coordenadas con varios patrones (la
// estructura del JSON de Idealista varía). Devuelve el primer par plausible.
function extractCoordsFromHtml(
  rawHtml: string,
): { latitude: number; longitude: number } | null {
  const tryPair = (
    lat: string | undefined,
    lng: string | undefined,
  ): { latitude: number; longitude: number } | null => {
    if (!lat || !lng) return null;
    const la = parseFloat(lat);
    const ln = parseFloat(lng);
    return isSpainCoord(la, ln) ? { latitude: la, longitude: ln } : null;
  };

  // 1) "latitude": 40.12, "longitude": -3.45  (orden lat→lng)
  let m = rawHtml.match(
    /"latitude"\s*:\s*"?(-?\d{1,2}\.\d{3,})"?\s*,\s*"longitude"\s*:\s*"?(-?\d{1,3}\.\d{3,})"?/,
  );
  let r = tryPair(m?.[1], m?.[2]);
  if (r) return r;

  // 2) "longitude": -3.45, "latitude": 40.12  (orden lng→lat)
  m = rawHtml.match(
    /"longitude"\s*:\s*"?(-?\d{1,3}\.\d{3,})"?\s*,\s*"latitude"\s*:\s*"?(-?\d{1,2}\.\d{3,})"?/,
  );
  r = tryPair(m?.[2], m?.[1]);
  if (r) return r;

  // 3) Static map / params: center=40.12,-3.45  ó  center=40.12%2C-3.45
  m = rawHtml.match(
    /center=(-?\d{1,2}\.\d{3,})(?:%2C|,)(-?\d{1,3}\.\d{3,})/i,
  );
  r = tryPair(m?.[1], m?.[2]);
  if (r) return r;

  // 4) data-lat="40.12" ... data-lng="-3.45"
  m = rawHtml.match(
    /data-lat(?:itude)?\s*=\s*["'](-?\d{1,2}\.\d{3,})["'][\s\S]{0,80}?data-l(?:ng|on|ongitude)\s*=\s*["'](-?\d{1,3}\.\d{3,})["']/i,
  );
  r = tryPair(m?.[1], m?.[2]);
  if (r) return r;

  return null;
}

// Palabras que identifican una vía (calle, avenida…). Si el texto las
// contiene, es una dirección de calle (no un nombre de barrio/zona).
const STREET_KEYWORDS =
  /\b(calle|c\/|avda?\.?|avenida|paseo|p\.?º|plaza|pl\.|camino|carretera|ctra\.?|ronda|traves[ií]a|v[ií]a|glorieta|bulevar|gran\s+v[ií]a|cuesta|costanilla|callej[oó]n)\b/i;

// Extrae la dirección exacta (calle + número) del título cuando el anunciante
// la muestra. Idealista titula "Piso en venta en Calle de X, 81". Si el título
// solo trae la zona ("…en Valdebebas - Valdefuentes, Madrid") devuelve null.
function extractExactAddressFromTitle(title: string | null): string | null {
  if (!title) return null;
  // Texto tras el último " en " (la parte de la ubicación del título).
  const idx = title.toLowerCase().lastIndexOf(" en ");
  const tail = idx >= 0 ? title.slice(idx + 4).trim() : title.trim();
  if (!STREET_KEYWORDS.test(tail)) return null;
  // Es una vía. Devolvemos tal cual (incluye número si el título lo trae).
  return tail;
}

// Dirección exacta desde el bloque de ubicación del DOM. Idealista muestra la
// dirección exacta (calle + número) en la sección de ubicación cuando es pública,
// frecuentemente en la primera línea antes de zona/distrito.
function extractExactAddressFromDom($: CheerioAPI): string | null {
  // 1) Selectores específicos del bloque de ubicación. Idealista varía la
  // estructura según el dispositivo/región, así que intentamos múltiples.
  const candidates = [
    "#mapWrapper .address",
    ".address",
    "#headerMap .main-info__title-minor",
    ".main-info__title-minor",
    "[data-location]",
    ".main-info__ubicacion",
    ".location-data",
    // Selectores adicionales para variantes modernas de Idealista
    "[data-location-address]",
    ".location__address",
    ".address-block",
    ".property-address",
    "h2.info-data, h2.main-info__title",
  ];
  for (const sel of candidates) {
    const txt = $(sel).first().text().trim();
    if (txt && STREET_KEYWORDS.test(txt)) {
      return txt.split("\n")[0].trim();
    }
  }

  // 2) Búsqueda amplia: cualquier elemento que contenga una calle + número
  // (patrón: "Calle X, NN" donde NN es número de 1-4 dígitos).
  const fullText = $("body").text();

  // Intentamos dos variantes de regex:
  // - Versión estricta: "Calle Nombre, NN" (con coma antes del número)
  // - Versión flexible: "Calle Nombre NN" (sin coma)
  const strictPattern = new RegExp(
    `\\b(${[
      'calle|c/',
      'avda?',
      'avenida',
      'paseo',
      "p\\.?º",
      'plaza',
      'pl\\.',
      'camino',
      'carretera',
      'ctra\\.?',
      'ronda',
      'traves[ií]a',
      'v[ií]a',
      'glorieta',
      'bulevar',
      'gran\\s+v[ií]a',
      'cuesta',
      'costanilla',
      'callej[oó]n',
    ].join('|')})\\s+[^,\\d]{2,50},\\s*\\d{1,4}(?:\\s|$|,)`,
    'i'
  );

  // Pattern flexible que acepta también "Calle Nombre NN" sin coma
  const flexiblePattern = new RegExp(
    `\\b(${[
      'calle|c/',
      'avda?',
      'avenida',
      'paseo',
      "p\\.?º",
      'plaza',
      'pl\\.',
      'camino',
      'carretera',
      'ctra\\.?',
      'ronda',
      'traves[ií]a',
      'v[ií]a',
      'glorieta',
      'bulevar',
      'gran\\s+v[ía]a',
      'cuesta',
      'costanilla',
      'callej[oó]n',
    ].join('|')})\\s+[^,\\d]{2,50}\\s+\\d{1,4}(?:\\s|$|,)`,
    'i'
  );

  let match = fullText.match(strictPattern) || fullText.match(flexiblePattern);
  if (match) {
    // Tomar la línea que contiene el match (antes del primer salto de línea)
    const idx = fullText.indexOf(match[0]);
    let lineEnd = fullText.indexOf('\n', idx);
    if (lineEnd === -1) lineEnd = fullText.length;
    return fullText.slice(idx, lineEnd).trim();
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point del extractor de Idealista.
// ─────────────────────────────────────────────────────────────────────────────
export async function extractIdealista(
  $: CheerioAPI,
  sourceUrl: string,
  options?: { proxyUrl?: string }
): Promise<ImportPreview> {
  const embedded = findEmbeddedListing($);
  const preview = embedded
    ? listingToPreview(embedded, sourceUrl)
    : extractFromDom($, sourceUrl);

  // Detectar particular vs profesional desde el HTML (campo
  // `adProfessionalName`). Más fiable que el endpoint AJAX (que DataDome
  // bloquea) y sin coste de request extra.
  const rawHtml = $.html();
  let advertiserInfo = detectAdvertiserFromHtml(rawHtml);

  // Si no encontramos teléfono en el HTML (común en Idealista moderno donde
  // el teléfono está tras "Ver teléfono"), intentamos obtenerlo vía AJAX
  // usando el mismo bypass de DataDome (TLS fingerprint de curl + UA WhatsApp).
  if (!advertiserInfo.phone && embedded?.propertyCode) {
    console.log(`[idealista-extractor] Iniciando AJAX para propertyCode=${embedded.propertyCode}`);
    try {
      const ajaxResult = await fetchIdealistaPhoneViaAjax(
        embedded.propertyCode,
        { proxyUrl: options?.proxyUrl }
      );
      if (ajaxResult.phone) {
        console.log(`[idealista-extractor] ✓ AJAX devolvió teléfono: ${ajaxResult.phone}`);
        advertiserInfo = {
          ...advertiserInfo,
          phone: ajaxResult.phone,
          phone_confidence: ajaxResult.phone_confidence,
          contact_name: ajaxResult.contact_name ?? advertiserInfo.contact_name,
        };
      } else {
        console.log(`[idealista-extractor] ✗ AJAX no devolvió teléfono para propertyCode=${embedded.propertyCode}`);
      }
    } catch (err) {
      // Silenciosamente ignoramos errores de AJAX (DataDome bloqueos, timeouts).
      // El extractor sigue adelante sin el teléfono extra.
      console.error(`[idealista-extractor] Error AJAX: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (!advertiserInfo.phone && !embedded?.propertyCode) {
    console.log(`[idealista-extractor] No hay propertyCode embebido, no se puede hacer AJAX fallback`);
  }

  // ── Coordenadas: lo más cercano posible al piso real ───────────────────────
  // Prioridad: las del listing embebido (planas o anidadas en `ubication`) →
  // las que escaneemos del HTML crudo. Cualquiera de estas es mejor que
  // geocodificar el nombre de la zona.
  let latitude = preview.latitude;
  let longitude = preview.longitude;
  if (latitude == null || longitude == null) {
    const embLat = embedded?.latitude ?? embedded?.ubication?.latitude;
    const embLng = embedded?.longitude ?? embedded?.ubication?.longitude;
    if (embLat != null && embLng != null && isSpainCoord(embLat, embLng)) {
      latitude = embLat;
      longitude = embLng;
    }
  }
  if (latitude == null || longitude == null) {
    const scanned = extractCoordsFromHtml(rawHtml);
    if (scanned) {
      latitude = scanned.latitude;
      longitude = scanned.longitude;
    }
  }

  // ── Dirección exacta (calle + número) si el anunciante la muestra ──────────
  // Si el listing ya trajo una dirección con pinta de calle, la respetamos;
  // si no, intentamos sacarla del título y del DOM. Nunca inventamos: si solo
  // hay zona, dejamos la dirección como estaba (posiblemente null).
  let address = preview.address;
  const looksLikeStreet = address ? STREET_KEYWORDS.test(address) : false;
  if (!looksLikeStreet) {
    const exact =
      extractExactAddressFromTitle(preview.title) ??
      extractExactAddressFromDom($);
    if (exact) {
      // Completar con municipio/zona para que el geocoder acierte.
      const tail = [preview.zone, "Madrid"].filter(Boolean).join(", ");
      address = tail ? `${exact}, ${tail}` : exact;
    }
  }

  return {
    ...preview,
    address,
    latitude,
    longitude,
    advertiserInfo,
    floorPlanUrl: extractFloorPlanUrl($, embedded),
    videoUrl: extractVideoUrl($),
  };
}
