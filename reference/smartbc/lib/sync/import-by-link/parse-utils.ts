import type { CheerioAPI } from "cheerio";
import { collectUrlStrings, extractJsonLd, extractNextData } from "../scrapers/image-utils";

// Utilidades de parsing compartidas por los extractores de import-by-link.

/**
 * Parsea precios escritos en español: "1.250.000 €", "1,250,000 USD",
 * "850.000 € / mes". Devuelve un entero (sin decimales) o null si no se
 * detecta un número plausible (>= 100).
 */
export function parsePriceString(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[ \s]/g, "");
  // Quita símbolos de moneda y prefijos.
  const noSym = cleaned.replace(/[€$£¥]/g, "");
  // Si tiene tanto . como , asumimos que . es separador de miles (formato es).
  const numericLike = noSym.match(/-?\d[\d.,]*/);
  if (!numericLike) return null;
  let raw = numericLike[0];
  if (raw.includes(".") && raw.includes(",")) {
    // "1.250.000,50" → quitar puntos, cambiar coma por punto.
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (raw.includes(",")) {
    // "1,250,000" o "1,5". Heurística: si la última coma deja <=2 dígitos
    // a la derecha, es decimal; si no, es miles.
    const lastComma = raw.lastIndexOf(",");
    const afterComma = raw.length - lastComma - 1;
    if (afterComma <= 2) raw = raw.replace(",", ".");
    else raw = raw.replace(/,/g, "");
  } else if (raw.includes(".")) {
    // "1.250.000" → miles; "1.5" → decimal. Heurística similar.
    const lastDot = raw.lastIndexOf(".");
    const afterDot = raw.length - lastDot - 1;
    if (afterDot === 3 && /^\d{1,3}(?:\.\d{3})+$/.test(raw)) {
      raw = raw.replace(/\./g, "");
    }
  }
  const n = parseFloat(raw);
  if (!isFinite(n) || n < 100) return null;
  return Math.round(n);
}

/** "120 m²" / "120m2" / "120 metros" → 120 */
export function parseAreaString(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d{2,5}(?:[.,]\d+)?)\s*(?:m\s*²|m2|metros?|sqm)/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/** "3 habitaciones" / "3 dorm" / "3 hab" / "3 bedrooms" → 3 */
export function parseBedrooms(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d{1,2})\s*(?:dorm|hab|bedroom|alcoba|cuarto)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!isFinite(n)) return null;
  return n;
}

/** "2 baños" / "2 bathrooms" / "2 WC" → 2 */
export function parseBathrooms(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d{1,2})\s*(?:ba(?:ñ|n)o|bathroom|wc|aseo)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!isFinite(n)) return null;
  return n;
}

export function getMeta($: CheerioAPI, prop: string): string | null {
  const v =
    $(`meta[property="${prop}"]`).attr("content") ??
    $(`meta[name="${prop}"]`).attr("content") ??
    null;
  return v?.trim() || null;
}

/**
 * Busca el primer nodo JSON-LD de tipo @type === wantedType (o que lo
 * incluya en array). Útil para Schema.org `RealEstateListing` / `Product`.
 */
export function findJsonLdByType(
  $: CheerioAPI,
  wantedTypes: string[],
): Record<string, unknown> | null {
  const blocks = extractJsonLd($);
  for (const block of blocks) {
    const candidates: unknown[] = Array.isArray(block) ? block : [block];
    for (const c of candidates) {
      if (!c || typeof c !== "object") continue;
      const obj = c as Record<string, unknown>;
      const t = obj["@type"];
      const types = Array.isArray(t) ? t : [t];
      for (const tt of types) {
        if (typeof tt === "string" && wantedTypes.some((w) => w.toLowerCase() === tt.toLowerCase())) {
          return obj;
        }
      }
    }
  }
  return null;
}

/** Lee el primer string no vacío de un array de selectors CSS. */
export function firstText($: CheerioAPI, selectors: string[]): string | null {
  for (const sel of selectors) {
    const txt = $(sel).first().text().trim();
    if (txt) return txt;
  }
  return null;
}

/**
 * Genera un `external_id` determinista a partir del URL: prefijo del portal
 * + segmento numérico del path si existe, o hash corto del path completo.
 */
export function externalIdFromUrl(portalPrefix: string, url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    const numeric = path.match(/(\d{4,})/);
    if (numeric) return `${portalPrefix}-${numeric[1]}`;
    // Hash 32-bit determinista del path completo.
    let h = 0;
    for (let i = 0; i < path.length; i++) {
      h = (h * 31 + path.charCodeAt(i)) | 0;
    }
    return `${portalPrefix}-${(h >>> 0).toString(36)}`;
  } catch {
    return `${portalPrefix}-${Date.now().toString(36)}`;
  }
}

/** Re-export para que los extractores no importen image-utils directamente. */
export { collectUrlStrings, extractNextData };
