import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element } from "domhandler";

// Helpers compartidos por los extractores de imagen de los distintos portales.
// El objetivo es centralizar: filtrado de no-fotos (logos, iconos, mapas...),
// deduplicación ignorando query params irrelevantes y selección de la variante
// de mayor calidad de un <img> (data-original > data-src > src > primer srcset).

// Palabras clave que descartan una URL de inmediato: logos, iconos, banners,
// mapas, marcadores, avatares, sellos de calidad, etc. La comparación es
// case-insensitive sobre la URL completa.
const EXCLUDE_KEYWORDS = [
  "logo",
  "icon",
  "favicon",
  "avatar",
  "agency",
  "brand",
  "marker",
  "placeholder",
  "loading",
  "no-image",
  "noimage",
  "no_image",
  "banner",
  "ads",
  "advert",
  "publicidad",
  "stamp",
  "sello",
  "quality",
  "flag",
  "flags",
  "/maps/",
  "google-maps",
  "googlemaps",
  "static-map",
  "staticmap",
  "spinner",
  "loader",
  "blank.gif",
  "1x1.gif",
  "pixel.gif",
] as const;

// Esquemas no aceptables: data URIs, mailto, blob, etc.
const NON_HTTP_PREFIXES = ["data:", "mailto:", "blob:", "javascript:"] as const;

export function isLikelyNonPhoto(url: string): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  for (const prefix of NON_HTTP_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  for (const kw of EXCLUDE_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  // SVG suele ser iconografía / branding.
  if (/\.svg(?:$|[?#])/i.test(lower)) return true;
  return false;
}

// Query params típicos de tracking / sizing que no cambian la imagen real.
// Si dos URLs solo difieren en estos, las tratamos como la misma foto.
const VOLATILE_QUERY_PARAMS = new Set([
  "width",
  "height",
  "w",
  "h",
  "quality",
  "q",
  "size",
  "auto",
  "format",
  "fit",
  "crop",
  "dpr",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
  "_t",
  "t",
  "v",
]);

/**
 * Clave de deduplicación: misma URL salvo por query params irrelevantes.
 * Si la URL no es parseable, cae a la cadena original.
 */
export function dedupKey(url: string): string {
  try {
    const u = new URL(url);
    const filtered: [string, string][] = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (!VOLATILE_QUERY_PARAMS.has(k.toLowerCase())) filtered.push([k, v]);
    }
    filtered.sort(([a], [b]) => a.localeCompare(b));
    u.search = "";
    for (const [k, v] of filtered) u.searchParams.append(k, v);
    // Normaliza host a lowercase; path mantiene su case.
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Resuelve una URL relativa contra una base. Si la URL ya es absoluta,
 * la devuelve tal cual. Si la URL es inválida, devuelve null.
 */
export function resolveUrl(raw: string | undefined, baseUrl?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * De un `srcset` devuelve la URL del candidato con mayor descriptor
 * (1920w mejor que 320w; 2x mejor que 1x). Si no se puede parsear, devuelve
 * la primera entrada.
 */
export function bestFromSrcset(srcset: string | undefined): string | undefined {
  if (!srcset) return undefined;
  const parts = srcset
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  let bestUrl: string | undefined;
  let bestScore = -1;
  for (const part of parts) {
    const [url, descriptor] = part.split(/\s+/);
    if (!url) continue;
    let score = 0;
    if (descriptor) {
      const wMatch = descriptor.match(/^(\d+(?:\.\d+)?)w$/i);
      const xMatch = descriptor.match(/^(\d+(?:\.\d+)?)x$/i);
      if (wMatch) score = parseFloat(wMatch[1]);
      else if (xMatch) score = parseFloat(xMatch[1]) * 1000;
    }
    if (score > bestScore) {
      bestScore = score;
      bestUrl = url;
    }
  }
  return bestUrl ?? parts[0]?.split(/\s+/)[0];
}

/**
 * Para un <img> elige la variante de mayor calidad disponible.
 * Orden de preferencia: data-original > data-src > el mejor del srcset > src.
 * srcset gana a src porque suele exponer la versión grande explícitamente.
 */
export function pickBestImgVariant(
  $el: Cheerio<Element>,
): string | undefined {
  const dataOriginal = $el.attr("data-original");
  const dataSrc = $el.attr("data-src");
  const srcset = $el.attr("srcset") ?? $el.attr("data-srcset");
  const src = $el.attr("src");
  const bestSrcset = bestFromSrcset(srcset);

  for (const c of [dataOriginal, dataSrc, bestSrcset, src]) {
    if (c && c.trim()) return c.trim();
  }
  return undefined;
}

/**
 * Extrae URLs de imagen de declaraciones inline `background-image: url(...)`.
 * Soporta comillas simples, dobles o sin comillas.
 */
export function extractBackgroundUrls(style: string | undefined): string[] {
  if (!style) return [];
  const out: string[] = [];
  const re = /background(?:-image)?\s*:\s*url\((['"]?)([^)'"]+)\1\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(style)) !== null) {
    if (m[2]) out.push(m[2]);
  }
  return out;
}

/**
 * Recorre todos los <script type="application/ld+json"> y devuelve sus
 * objetos parseados. Útil para Idealista/Fotocasa que exponen Schema.org.
 */
export function extractJsonLd($: CheerioAPI): unknown[] {
  const out: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const txt = $(el).contents().text();
    if (!txt) return;
    try {
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      // ignora JSON-LD malformado
    }
  });
  return out;
}

/**
 * Lee el contenido del `<script id="__NEXT_DATA__">` (Next.js / Fotocasa)
 * y devuelve el objeto parseado, o null.
 */
export function extractNextData($: CheerioAPI): unknown | null {
  const txt = $('script#__NEXT_DATA__').contents().text();
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

/**
 * Recursivamente recolecta todas las cadenas que parecen URLs HTTP(S) dentro
 * de cualquier estructura JSON. Útil para encontrar fotos enterradas en
 * __NEXT_DATA__ o JSON-LD sin saber el shape exacto.
 */
export function collectUrlStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectUrlStrings(v, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectUrlStrings(v, out);
    }
  }
  return out;
}

/**
 * Acumulador con deduplicación incorporada: añade URLs respetando la primera
 * vista de cada `dedupKey`. Útil para componer listas finales de fotos.
 */
export class PhotoCollector {
  private readonly seen = new Set<string>();
  private readonly photos: { url: string; alt?: string }[] = [];

  add(url: string | null | undefined, alt?: string): void {
    if (!url) return;
    if (isLikelyNonPhoto(url)) return;
    this.push(url, alt);
  }

  // Para cuando el extractor específico ya validó la URL con reglas
  // propias del portal (ej. Fotocasa sabe que `/images/ads/<uuid>` es
  // foto del anuncio, no advertising). Salta el filtro genérico
  // `isLikelyNonPhoto` que rechazaría por la palabra "ads".
  addTrusted(url: string | null | undefined, alt?: string): void {
    if (!url) return;
    this.push(url, alt);
  }

  private push(url: string, alt?: string): void {
    const key = dedupKey(url);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.photos.push({ url, alt: alt || undefined });
  }

  toArray(): { url: string; alt?: string }[] {
    return this.photos.slice();
  }
}
