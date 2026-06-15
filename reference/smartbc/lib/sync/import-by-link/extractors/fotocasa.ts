import type { CheerioAPI } from "cheerio";
import type { ImportPreview } from "../types";
import { detectAdvertiserFromHtml } from "../../particulares/idealista-advertiser-detector";
import { extractFotocasaPhotos } from "../../scrapers/fotocasa";
import {
  collectUrlStrings,
  externalIdFromUrl,
  extractNextData,
  findJsonLdByType,
  firstText,
  getMeta,
  parseAreaString,
  parseBathrooms,
  parseBedrooms,
  parsePriceString,
} from "../parse-utils";

// Extractor de fichas de Fotocasa. La fuente más fiable es __NEXT_DATA__
// (Fotocasa es Next.js) — incluye el objeto completo de la propiedad.
// Caemos a JSON-LD y selectores CSS como fallback.

function pickFromNext(value: unknown, keys: string[]): unknown {
  // Busca recursivamente cualquier objeto que tenga ALGUNA de las keys.
  // Devuelve el primer match.
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = pickFromNext(v, keys);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  for (const k of keys) {
    if (k in obj) return obj;
  }
  for (const v of Object.values(obj)) {
    const found = pickFromNext(v, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function extractFotocasa(
  $: CheerioAPI,
  sourceUrl: string,
): ImportPreview {
  const warnings: string[] = [];

  const nextData = extractNextData($);
  let title: string | null = null;
  let description: string | null = null;
  let price: number | null = null;
  let currency: string | null = null;
  let bedrooms: number | null = null;
  let bathrooms: number | null = null;
  let squareMeters: number | null = null;
  let zone: string | null = null;
  let address: string | null = null;
  const features: string[] = [];

  if (nextData) {
    // Fotocasa guarda la ficha bajo `pageProps.initialState.realEstate` o
    // `props.pageProps.detail`. Buscamos cualquier objeto con `transactionTypeId`
    // o `propertyTypeId` que son típicos de la entidad.
    const detail = pickFromNext(nextData, [
      "realEstate",
      "detail",
      "propertyData",
      "adData",
    ]) as Record<string, unknown> | undefined;
    if (detail) {
      const re = (detail.realEstate ?? detail.detail ?? detail.propertyData ?? detail.adData ?? detail) as
        | Record<string, unknown>
        | undefined;
      if (re && typeof re === "object") {
        if (typeof re.title === "string") title = re.title;
        if (typeof re.description === "string") description = re.description;
        if (typeof re.price === "number") price = re.price;
        else if (typeof re.price === "string") price = parsePriceString(re.price);
        if (typeof re.currency === "string") currency = re.currency;
        else currency = "EUR";

        const features_ = re.features as Record<string, unknown> | undefined;
        if (features_ && typeof features_ === "object") {
          if (typeof features_.rooms === "number") bedrooms = features_.rooms;
          if (typeof features_.bathrooms === "number") bathrooms = features_.bathrooms;
          if (typeof features_.surface === "number")
            squareMeters = Math.round(features_.surface);
        }

        const loc = re.location ?? re.address;
        if (loc && typeof loc === "object") {
          const l = loc as Record<string, unknown>;
          if (typeof l.zoneName === "string") zone = l.zoneName;
          else if (typeof l.cityName === "string") zone = l.cityName;
          const parts = [l.streetName, l.zoneName, l.cityName].filter(
            (x): x is string => typeof x === "string",
          );
          if (parts.length) address = parts.join(", ");
        }

        // Lista de features booleanas → strings.
        const featTags = re.featureTags ?? re.tags;
        if (Array.isArray(featTags)) {
          for (const t of featTags) {
            if (typeof t === "string") features.push(t);
            else if (t && typeof t === "object" && typeof (t as Record<string, unknown>).label === "string") {
              features.push((t as Record<string, unknown>).label as string);
            }
          }
        }
      }
    }
  }

  // Fallbacks DOM/meta.
  title =
    title ??
    firstText($, ["h1", ".re-DetailHeader-propertyTitle"]) ??
    getMeta($, "og:title");

  description =
    description ??
    firstText($, [".re-DetailDescription-text", ".detail-description"]) ??
    getMeta($, "og:description");

  if (price === null) {
    const priceText = firstText($, [
      ".re-DetailHeader-price",
      ".re-Price",
      ".price",
    ]);
    if (priceText) price = parsePriceString(priceText);
  }
  if (price === null) {
    const ld = findJsonLdByType($, ["Product", "RealEstateListing", "Residence"]);
    if (ld) {
      for (const url of collectUrlStrings(ld)) void url; // suppress unused
      const offers = ld["offers"];
      if (offers && typeof offers === "object") {
        const o = offers as Record<string, unknown>;
        const p = typeof o.price === "number" || typeof o.price === "string" ? String(o.price) : null;
        price = parsePriceString(p);
        if (typeof o.priceCurrency === "string") currency = o.priceCurrency;
      }
    }
  }

  if (bedrooms === null) bedrooms = parseBedrooms(description ?? "") ?? parseBedrooms(title ?? "");
  if (bathrooms === null) bathrooms = parseBathrooms(description ?? "") ?? parseBathrooms(title ?? "");
  if (squareMeters === null) squareMeters = parseAreaString(description ?? "") ?? parseAreaString(title ?? "");

  // Operación: path /comprar- vs /alquiler-.
  let operation: "rent" | "sale" | null = null;
  if (/\/comprar-/i.test(sourceUrl) || /\/vivienda\/.*\/venta/i.test(sourceUrl)) operation = "sale";
  if (/\/alquiler-/i.test(sourceUrl)) operation = "rent";

  const photos = extractFotocasaPhotos($, sourceUrl);

  // Extraer información de contacto (teléfono, tipo de anunciante) del HTML
  const advertiserInfo = detectAdvertiserFromHtml($.html());

  if (!title) warnings.push("título no detectado");
  if (price === null) warnings.push("precio no detectado");
  if (photos.length === 0)
    warnings.push("sin fotos — Fotocasa puede haber servido página antibot");

  return {
    portal: "fotocasa",
    sourceUrl,
    externalReference: externalIdFromUrl("fotocasa", sourceUrl),
    title: title ?? null,
    description: description ?? null,
    operation,
    stay: null,
    price,
    currency: currency ?? "EUR",
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
    advertiserInfo,
  };
}
