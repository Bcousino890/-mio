import type { CheerioAPI } from "cheerio";
import type { RawPhoto } from "../types";
import {
  PhotoCollector,
  collectUrlStrings,
  extractBackgroundUrls,
  extractJsonLd,
  extractNextData,
  isLikelyNonPhoto,
  pickBestImgVariant,
  resolveUrl,
} from "./image-utils";

// Reglas de imagen para sitios construidos sobre Inmoweb.
// Inmoweb es una plataforma multi-tenant: cada inmobiliaria puede servir
// fotos desde su propio dominio, un CDN propio o un subdominio inmoweb.*.
// Por eso la detección NO se basa en host concreto sino en patrones de path
// típicos de fotos de inmueble.

const PROPERTY_PATH_FRAGMENTS = [
  "/images/",
  "/imagenes/",
  "/fotos/",
  "/photos/",
  "/uploads/",
  "/inmuebles/",
  "/properties/",
  "/galeria/",
  "/gallery/",
  "/media/",
] as const;

const ACCEPTED_EXT_RE = /\.(?:jpe?g|png|webp)(?:$|[?#])/i;

// Patrones de URL de thumbnail con su "ascenso" a versión grande. Conservadores
// (solo reemplazan, nunca inventan paths nuevos imposibles).
const THUMB_PATTERNS: { from: RegExp; to: string }[] = [
  // /thumbs/foto.jpg → /foto.jpg
  { from: /\/thumbs\//i, to: "/" },
  { from: /\/thumbnail\//i, to: "/" },
  { from: /\/thumbnails\//i, to: "/" },
  // foto-thumb.jpg → foto.jpg
  { from: /-thumb(?=\.[a-z]+(?:$|[?#]))/i, to: "" },
  { from: /-thumbnail(?=\.[a-z]+(?:$|[?#]))/i, to: "" },
  // foto-small.jpg / foto_small.jpg → foto.jpg
  { from: /[-_]small(?=\.[a-z]+(?:$|[?#]))/i, to: "" },
  { from: /[-_]sm(?=\.[a-z]+(?:$|[?#]))/i, to: "" },
  { from: /[-_]mini(?=\.[a-z]+(?:$|[?#]))/i, to: "" },
];

export function isInmowebPhotoUrl(url: string): boolean {
  if (!url) return false;
  if (isLikelyNonPhoto(url)) return false;
  if (!ACCEPTED_EXT_RE.test(url)) return false;
  const lower = url.toLowerCase();
  for (const frag of PROPERTY_PATH_FRAGMENTS) {
    if (lower.includes(frag)) return true;
  }
  return false;
}

/**
 * Conservative upgrade: solo reemplaza patrones conocidos de thumbnail y
 * deja la URL igual si no hay match. NUNCA inventa una URL no observada en
 * el HTML — esto puede dejar a veces una versión pequeña, pero el dedup
 * (en PhotoCollector) prefiere la primera ocurrencia y los <source srcset>
 * suelen exponer la versión grande antes que las miniaturas.
 */
export function toInmowebHighQuality(url: string): string {
  let out = url;
  for (const rule of THUMB_PATTERNS) {
    if (rule.from.test(out)) {
      out = out.replace(rule.from, rule.to);
    }
  }
  return out;
}

export function extractInmowebPhotos(
  $: CheerioAPI,
  baseUrl?: string,
): RawPhoto[] {
  const collector = new PhotoCollector();

  const consider = (raw: string | null | undefined, alt?: string) => {
    const resolved = resolveUrl(raw ?? undefined, baseUrl);
    if (!resolved) return;
    if (!isInmowebPhotoUrl(resolved)) return;
    collector.add(toInmowebHighQuality(resolved), alt);
  };

  // 1) <img>
  $("img").each((_, el) => {
    const $el = $(el);
    const best = pickBestImgVariant($el);
    consider(best, $el.attr("alt") ?? undefined);
  });

  // 2) <source> dentro de <picture>
  $("source").each((_, el) => {
    const $el = $(el);
    const srcset = $el.attr("srcset") ?? $el.attr("data-srcset");
    if (!srcset) return;
    for (const part of srcset.split(",")) {
      const url = part.trim().split(/\s+/)[0];
      consider(url);
    }
  });

  // 3) background-image en style inline (carouseles tipo slick / swiper).
  $("[style]").each((_, el) => {
    const style = $(el).attr("style");
    for (const raw of extractBackgroundUrls(style)) consider(raw);
  });

  // 4) Elementos con data-image / data-bg / data-background (lazy carousels).
  $("[data-image], [data-bg], [data-background]").each((_, el) => {
    const $el = $(el);
    consider($el.attr("data-image"));
    consider($el.attr("data-bg"));
    consider($el.attr("data-background"));
  });

  // 5) <a> que envuelve fotos de galería (lightbox típicos apuntan al original).
  $("a[href]").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    if (!href) return;
    if (ACCEPTED_EXT_RE.test(href)) consider(href);
  });

  // 6) JSON embebido (poco habitual en Inmoweb pero algunos themes lo usan).
  const nextData = extractNextData($);
  if (nextData) {
    for (const url of collectUrlStrings(nextData)) consider(url);
  }
  for (const obj of extractJsonLd($)) {
    for (const url of collectUrlStrings(obj)) consider(url);
  }

  return collector.toArray();
}
