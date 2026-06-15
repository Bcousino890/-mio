import "server-only";
import type { NormalizedProperty, RawProperty } from "./types";

const SLUG_DIACRITICS = /[̀-ͯ]/g;
const SLUG_NON_ALPHA = /[^a-z0-9]+/g;

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(SLUG_DIACRITICS, "")
    .toLowerCase()
    .replace(SLUG_NON_ALPHA, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export function buildPropertySlug(
  _agencySlug: string,
  externalId: string,
  title: string,
): string {
  // El externalId va SIEMPRE completo al final para garantizar unicidad
  // entre dos propiedades con título idéntico. La agencia NO entra en el
  // slug a propósito: queremos URLs neutras (`/compartir/titulo-3291`)
  // sin exponer al cliente final que la propiedad viene de un portal de
  // sindicación concreto. La tabla `legacy_slugs` mantiene los redirects
  // desde slugs antiguos para no romper SmartLinks ya enviados.
  const ext = slugify(externalId);
  const suffix = `-${ext}`;
  const maxTitleLen = Math.max(1, 120 - suffix.length);
  const base = (slugify(title) || "propiedad").slice(0, maxTitleLen);
  return `${base}${suffix}`;
}

export function normalizeRawProperty(
  raw: RawProperty,
  agencySlug: string,
): NormalizedProperty {
  return {
    external_id: raw.externalId,
    slug: buildPropertySlug(agencySlug, raw.externalId, raw.title),
    source_url: raw.sourceUrl,
    title: raw.title.trim(),
    description: raw.description?.trim() || null,
    operation: raw.operation,
    stay: raw.stay ?? null,
    property_type: raw.propertyType?.trim() || null,
    price: Math.max(0, Math.round(raw.price)),
    bedrooms: raw.bedrooms ?? 0,
    bathrooms: raw.bathrooms ?? 0,
    square_meters: raw.squareMeters ?? null,
    zone: raw.zone.trim(),
    subzone: raw.subzone?.trim() || null,
    address: raw.address?.trim() || null,
    available_from: raw.availableFrom ?? null,
    features: raw.features ?? [],
    photos: raw.photos,
  };
}
