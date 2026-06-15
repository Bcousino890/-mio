import type { CheerioAPI } from "cheerio";
import type { ImportPhoto, ImportPreview } from "../types";
import {
  getMeta,
  parseAreaString,
  parseBathrooms,
  parseBedrooms,
  parsePriceString,
} from "../parse-utils";

// Extractor para fichas de Clikalia (clikalia.es). La ficha es server-rendered
// (Next/Nuxt) sin JSON-LD ni __NEXT_DATA__, así que tiramos de:
//  - og:title  -> título + operación + calle
//  - bloque "Sobre la propiedad" -> descripción larga (con superficie, dormi-
//    torios y baños embebidos, que parseamos con los helpers).
//  - precio: span con clase `content-highlight` (el precio actual; el tachado
//    `line-through` es el precio anterior, que ignoramos).
//  - fotos: bucket de Google Cloud, filtradas por la referencia del inmueble
//    (la página incluye también fotos de "inmuebles similares").
//
// La marca de agua "clikalia" estampada en las fotos se quita después, al
// descargar, vía el perfil registrado en watermark-removal.ts.

const PHOTO_BUCKET = "es-api-clikoffice-infra-esp-pro";

// Clikalia sirve la ficha en varios idiomas (".../alquilar/en/inmueble/...").
// Forzamos SIEMPRE el español: así los datos (descripción, dormitorios, m²)
// llegan en el idioma que parseamos, sin importar qué link pegue el usuario.
export function normalizeClikaliaUrl(url: URL): URL {
  const next = new URL(url.toString());
  next.pathname = next.pathname.replace(
    /^\/(alquilar|comprar|vender|alquiler|venta)\/[a-z]{2}\//i,
    "/$1/es/",
  );
  return next;
}

// "https://.../madrid/ayala-AM1905" -> "AM1905"
function referenceFromUrl(url: string): string | null {
  const m = url.match(/-([A-Z]{2}\d{3,6})(?:[/?#]|$)/i);
  return m ? m[1].toUpperCase() : null;
}

// Quita cualquier rastro de la agencia de la descripción (requisito del cliente:
// los pisos no deben mencionar "Clikalia").
function sanitizeDescription(text: string): string {
  return text
    // Frase de apertura típica: "Clikalia presenta este piso ...".
    .replace(/^\s*clikalia[^.]*\.\s*/i, "")
    // Menciones sueltas restantes.
    .replace(/\bclikalia\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function stripTags(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ntilde;/gi, "ñ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Extrae las fotos del inmueble actual (las del bucket cuyo path empieza por su
// referencia), descartando planos de planta y duplicados, conservando el orden.
function extractClikaliaPhotos(html: string, ref: string | null): ImportPhoto[] {
  const re = new RegExp(
    `https://storage\\.googleapis\\.com/${PHOTO_BUCKET}/[^"'\\\\\\s]+?\\.(?:jpe?g|png|webp)`,
    "gi",
  );
  const seen = new Set<string>();
  const photos: ImportPhoto[] = [];
  for (const raw of html.match(re) ?? []) {
    const url = raw.replace(/\\$/, "");
    // Solo fotos de ESTE inmueble (la página trae también "similares").
    if (ref && !new RegExp(`/${ref}(?:%2F|/)`, "i").test(url)) continue;
    // Los planos de planta llevan texto y no son fotos reales.
    if (/FLOOR_PLAN/i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    photos.push({ url });
  }
  return photos;
}

export function extractClikalia(
  $: CheerioAPI,
  sourceUrl: string,
): ImportPreview {
  const warnings: string[] = [];
  const html = $.root().html() ?? "";
  const ref = referenceFromUrl(sourceUrl);

  const ogTitle = getMeta($, "og:title");
  const title = ogTitle;

  const operation: "rent" | "sale" | null =
    /\/alquilar\//i.test(sourceUrl) || /alquiler/i.test(ogTitle ?? "")
      ? "rent"
      : /\/comprar\//i.test(sourceUrl) || /venta/i.test(ogTitle ?? "")
        ? "sale"
        : null;

  // Descripción larga del bloque "Sobre la propiedad" (la og:description es
  // demasiado corta). Si no aparece, caemos a la og.
  let description: string | null = null;
  const descMatch = html.match(
    /Sobre la propiedad([\s\S]{20,2500}?)(?:Leer m[aá]s|Ficha t[eé]cnica)/i,
  );
  if (descMatch) {
    const candidate = stripTags(descMatch[1]);
    if (candidate.length > 20) description = candidate;
  }
  if (!description) description = getMeta($, "og:description");
  if (description) description = sanitizeDescription(description);

  // Texto base para superficie/dormitorios/baños: la descripción larga los
  // lleva embebidos ("superficie total de 62 m², ... 2 dormitorios y 1 baño").
  const detailText = `${description ?? ""} ${getMeta($, "og:description") ?? ""}`;
  const squareMeters = parseAreaString(detailText);
  const bedrooms = parseBedrooms(detailText);
  const bathrooms = parseBathrooms(detailText);

  // Precio: el texto plano de la ficha lleva el precio actual primero. En
  // alquiler aparece como "1.600 €/mes" (el precio anterior tachado va después
  // y lo ignoramos al quedarnos con la PRIMERA coincidencia). En venta es un
  // importe grande seguido de €.
  let price: number | null = null;
  const pageText = $.text();
  const rentMatch = pageText.match(/([\d][\d.,]*)\s*€\s*\/\s*mes/);
  if (rentMatch) {
    price = parsePriceString(rentMatch[1]);
  } else {
    // Venta: primer importe de 5-7 cifras con separador de miles seguido de €.
    const saleMatch = pageText.match(/(\d{2,3}\.\d{3}(?:\.\d{3})?)\s*€/);
    if (saleMatch) price = parsePriceString(saleMatch[1]);
  }

  // Dirección: og:title = "Piso en alquiler en Calle Ayala". Nos quedamos con
  // lo que va tras el ÚLTIMO "en" (greedy) para no cortar en "en alquiler".
  let address: string | null = null;
  if (ogTitle) {
    const a = ogTitle.match(/^.*\ben\s+(.+)$/i);
    if (a) address = a[1].trim();
  }

  const photos = extractClikaliaPhotos(html, ref);

  if (!title) warnings.push("título no detectado");
  if (price === null) warnings.push("precio no detectado — rellénalo a mano");
  if (squareMeters === null) warnings.push("superficie no detectada");
  if (photos.length === 0)
    warnings.push("sin fotos — Clikalia puede haber cambiado el formato");
  warnings.push("revisa la zona/subzona antes de publicar");

  return {
    portal: "clikalia",
    sourceUrl,
    externalReference: ref ?? `clikalia-${Buffer.from(sourceUrl).toString("base64url").slice(0, 12)}`,
    title: title ?? null,
    description: description ?? null,
    operation,
    stay: null,
    price,
    currency: price !== null ? "EUR" : null,
    bedrooms,
    bathrooms,
    squareMeters,
    zone: null,
    address,
    features: [],
    latitude: null,
    longitude: null,
    photos,
    rawAttributes: ref ? { referencia: ref } : {},
    warnings,
  };
}
