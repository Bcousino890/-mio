import type { CheerioAPI } from "cheerio";
import type { ImportPreview } from "../types";
import { extractInmowebPhotos } from "../../scrapers/inmoweb";
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

// Extractor para sitios construidos sobre Inmoweb. Inmoweb es multi-tenant
// (cada inmobiliaria tiene su tema), así que los selectores tienen que ser
// laxos. Apoyamos en JSON-LD si está, OG meta, y heurísticas de texto.

export function extractInmoweb(
  $: CheerioAPI,
  sourceUrl: string,
): ImportPreview {
  const warnings: string[] = [];

  const title =
    firstText($, ["h1", ".property-title", ".inmueble-titulo", ".titulo"]) ??
    getMeta($, "og:title");

  const description =
    firstText($, [
      ".property-description",
      ".descripcion",
      ".inmueble-descripcion",
      "#descripcion",
      ".comment",
    ]) ?? getMeta($, "og:description");

  // Precio: Inmoweb suele tener un span/h2 con el número y el €.
  let price: number | null = null;
  let currency: string | null = null;
  const priceText = firstText($, [
    ".price",
    ".precio",
    ".property-price",
    ".inmueble-precio",
  ]);
  if (priceText) {
    price = parsePriceString(priceText);
    if (/€/.test(priceText)) currency = "EUR";
  }
  if (price === null) {
    const ld = findJsonLdByType($, ["Product", "RealEstateListing"]);
    if (ld && typeof ld.offers === "object" && ld.offers) {
      const o = ld.offers as Record<string, unknown>;
      const p = typeof o.price === "number" || typeof o.price === "string" ? String(o.price) : null;
      price = parsePriceString(p);
      if (typeof o.priceCurrency === "string") currency = o.priceCurrency;
    }
  }

  // Características: la mayoría de temas usan listas dt/dd o un panel de
  // "Características" con li. Extraemos los li y los devolvemos como features
  // sin clasificar — el admin las edita.
  const features: string[] = [];
  $(".features li, .caracteristicas li, .property-features li").each((_, el) => {
    const txt = $(el).text().trim();
    if (txt && txt.length < 80) features.push(txt);
  });

  // m² / habitaciones / baños: parseamos del texto del bloque de detalles.
  const detailsText = $(".details, .detalles, .property-details").text() || description || "";
  const squareMeters = parseAreaString(detailsText) ?? parseAreaString(description ?? "");
  const bedrooms = parseBedrooms(detailsText) ?? parseBedrooms(description ?? "");
  const bathrooms = parseBathrooms(detailsText) ?? parseBathrooms(description ?? "");

  // Ubicación: Inmoweb a veces pone "Zona" y "Localidad" como labels.
  const zone =
    firstText($, [".zone", ".zona", ".property-zone", ".inmueble-zona"]) ??
    null;
  const address =
    firstText($, [".address", ".direccion", ".property-address"]) ?? zone;

  let operation: "rent" | "sale" | null = null;
  if (/alquiler/i.test(sourceUrl) || /alquiler/i.test(title ?? "") || /alquiler/i.test(detailsText)) operation = "rent";
  if (/venta/i.test(sourceUrl) || /comprar/i.test(sourceUrl) || /venta/i.test(title ?? "")) operation = "sale";

  const photos = extractInmowebPhotos($, sourceUrl);

  if (!title) warnings.push("título no detectado");
  if (price === null) warnings.push("precio no detectado");
  if (photos.length === 0)
    warnings.push("sin fotos — verifica que el theme de Inmoweb exponga galería en el HTML");

  return {
    portal: "inmoweb",
    sourceUrl,
    externalReference: externalIdFromUrl("inmoweb", sourceUrl),
    title: title ?? null,
    description: description ?? null,
    operation,
    stay: null,
    price,
    currency,
    bedrooms,
    bathrooms,
    squareMeters,
    zone,
    address,
    features,
    latitude: null,
    longitude: null,
    photos,
    rawAttributes: {},
    warnings,
  };
}
