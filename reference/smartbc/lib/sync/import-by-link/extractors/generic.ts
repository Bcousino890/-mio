import type { CheerioAPI } from "cheerio";
import type { ImportPreview, ImportPortal } from "../types";
import {
  externalIdFromUrl,
  findJsonLdByType,
  getMeta,
  parseAreaString,
  parseBathrooms,
  parseBedrooms,
  parsePriceString,
} from "../parse-utils";
import { collectUrlStrings } from "../../scrapers/image-utils";

// Extractor genérico: usa Open Graph y Schema.org JSON-LD para portales no
// soportados específicamente o como fallback cuando el extractor dedicado
// no encuentra datos. NUNCA es exhaustivo — su trabajo es cubrir lo básico
// (título, descripción, imagen) para que el admin tenga algo que editar.

export function extractGeneric(
  $: CheerioAPI,
  sourceUrl: string,
  portal: ImportPortal,
): ImportPreview {
  const warnings: string[] = [];

  const ogTitle = getMeta($, "og:title");
  const ogDesc = getMeta($, "og:description");
  const ogImage = getMeta($, "og:image");
  const title = ogTitle ?? ($("h1").first().text().trim() || null);
  const description = ogDesc ?? null;

  const jsonLd =
    findJsonLdByType($, ["RealEstateListing", "Residence", "Apartment", "House", "Accommodation", "Product"]) ??
    null;

  let price: number | null = null;
  let bedrooms: number | null = null;
  let bathrooms: number | null = null;
  let squareMeters: number | null = null;
  let zone: string | null = null;
  let address: string | null = null;
  let currency: string | null = null;

  if (jsonLd) {
    const offers = jsonLd["offers"];
    if (offers && typeof offers === "object") {
      const o = offers as Record<string, unknown>;
      const p = typeof o.price === "string" || typeof o.price === "number" ? String(o.price) : null;
      price = parsePriceString(p);
      currency = typeof o.priceCurrency === "string" ? o.priceCurrency : null;
    }
    const addr = jsonLd["address"];
    if (addr && typeof addr === "object") {
      const a = addr as Record<string, unknown>;
      const parts = [a.streetAddress, a.addressLocality, a.addressRegion]
        .filter((x): x is string => typeof x === "string");
      address = parts.join(", ") || null;
      zone = typeof a.addressLocality === "string" ? a.addressLocality : null;
    }
    const fr = jsonLd["floorSize"];
    if (fr && typeof fr === "object") {
      const v = (fr as Record<string, unknown>).value;
      if (typeof v === "number") squareMeters = Math.round(v);
      else if (typeof v === "string") squareMeters = parseAreaString(v);
    }
    if (typeof jsonLd["numberOfRooms"] === "number")
      bedrooms = jsonLd["numberOfRooms"] as number;
    if (typeof jsonLd["numberOfBathroomsTotal"] === "number")
      bathrooms = jsonLd["numberOfBathroomsTotal"] as number;
  }

  // Fallback: parsear de la descripción si no salió del JSON.
  if (bedrooms === null) bedrooms = parseBedrooms(description) ?? parseBedrooms(title);
  if (bathrooms === null) bathrooms = parseBathrooms(description) ?? parseBathrooms(title);
  if (squareMeters === null) squareMeters = parseAreaString(description) ?? parseAreaString(title);
  if (price === null) price = parsePriceString(description) ?? parsePriceString($("body").text());

  // Fotos: og:image como mínimo + cualquier URL en el JSON-LD que parezca
  // imagen. El extractor por-portal hace el filtrado fino.
  const photoSet = new Set<string>();
  if (ogImage) photoSet.add(ogImage);
  if (jsonLd) {
    for (const url of collectUrlStrings(jsonLd)) {
      if (/\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(url)) photoSet.add(url);
    }
  }
  $("img").each((_, el) => {
    const src = $(el).attr("data-original") ?? $(el).attr("data-src") ?? $(el).attr("src");
    if (!src) return;
    if (/^https?:\/\//.test(src) && /\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(src)) {
      photoSet.add(src);
    }
  });

  if (!title) warnings.push("título no detectado — el portal puede requerir JS");
  if (price === null) warnings.push("precio no detectado");
  if (photoSet.size === 0) warnings.push("no se encontraron fotos");

  return {
    portal,
    sourceUrl,
    externalReference: externalIdFromUrl(portal, sourceUrl),
    title,
    description,
    operation: null,
    stay: null,
    price,
    currency,
    bedrooms,
    bathrooms,
    squareMeters,
    zone,
    address,
    features: [],
    latitude: null,
    longitude: null,
    photos: Array.from(photoSet).map((url) => ({ url })),
    rawAttributes: {},
    warnings,
  };
}
