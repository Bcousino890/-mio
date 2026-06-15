import type { CheerioAPI } from "cheerio";
import type { RawPhoto } from "../types";
import {
  PhotoCollector,
  collectUrlStrings,
  extractJsonLd,
  extractNextData,
  pickBestImgVariant,
  resolveUrl,
} from "./image-utils";

// Reglas de imagen para Idealista (idealista.com / idealista.pt / idealista.it).
// El CDN sirve fotos desde img*.idealista.com con plantillas de tamaño tipo
// `WEB_DETAIL-XL-L`, `WEB_LISTING`, etc. Normalizamos siempre a
// `WEB_DETAIL_TOP-XL-L` que es la versión grande de detalle.

// Acepta cualquier subdominio: img.idealista.com, img1.idealista.com,
// img2.idealista.it, etc. Excluye explícitamente `logo` y `blur/static`.
const IDEALISTA_HOST_RE = /(?:^|\/\/)img\d*\.idealista\.[a-z]{2,3}/i;

// Tamaños conocidos del CDN. El orden NO importa para detección, solo
// los usamos como objetivos de reemplazo.
const IDEALISTA_SIZE_TOKENS = [
  "WEB_DETAIL_TOP-XL-L",
  "WEB_DETAIL-XL-L",
  "WEB_DETAIL-L-L",
  "WEB_DETAIL-L-S",
  "WEB_DETAIL-M-L",
  "WEB_LISTING",
  "WEB_DETAIL",
  "WEB_THUMB",
  "WEB_LIST",
] as const;

export function isIdealistaImageUrl(url: string): boolean {
  if (!url) return false;
  if (!IDEALISTA_HOST_RE.test(url)) return false;
  // Tiene que parecer una foto real, no un asset estático.
  if (/\/static\//i.test(url)) return false;
  if (/\/maps?\//i.test(url)) return false;
  return /\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(url);
}

// Perfil de imagen que SIEMPRE existe en el CDN y da buena resolución.
// Idealista expone perfiles compuestos como `WEB_DETAIL_TOP-XL-L_TOP-L-P`
// que devuelven 404 — por eso no basta con "subir" el token, hay que
// normalizar el segmento de perfil entero a uno conocido.
const SAFE_PROFILE = "WEB_DETAIL_TOP-L-L";

/**
 * Normaliza la URL de imagen del CDN de Idealista a un perfil de tamaño que
 * existe seguro. El perfil es el segmento entre `/blur/` y `/<n>/`
 * (`…/blur/<PERFIL>/0/id.pro.es.image.master/…`). Lo sustituimos por
 * SAFE_PROFILE. Si la URL no tiene ese patrón, cae al reemplazo por token.
 */
export function toIdealistaHighQuality(url: string): string {
  const blurRe = /(\/blur\/)[^/]+(\/\d+\/)/;
  if (blurRe.test(url)) {
    return url.replace(blurRe, `$1${SAFE_PROFILE}$2`);
  }
  for (const token of IDEALISTA_SIZE_TOKENS) {
    if (url.includes(token)) {
      return url.replace(token, SAFE_PROFILE);
    }
  }
  return url;
}

/**
 * Recolecta fotos del HTML de una ficha de Idealista. Combina varias fuentes
 * porque el CDN viene a veces inline en <img> y a veces dentro del JSON
 * embebido (multimediaCarrousel / propertyMultimedia).
 */
export function extractIdealistaPhotos(
  $: CheerioAPI,
  baseUrl?: string,
): RawPhoto[] {
  const collector = new PhotoCollector();

  const consider = (raw: string | null | undefined, alt?: string) => {
    const resolved = resolveUrl(raw ?? undefined, baseUrl);
    if (!resolved) return;
    if (!isIdealistaImageUrl(resolved)) return;
    collector.add(toIdealistaHighQuality(resolved), alt);
  };

  // 1) <img> (lazy o no) en el árbol DOM.
  $("img").each((_, el) => {
    const $el = $(el);
    const best = pickBestImgVariant($el);
    consider(best, $el.attr("alt") ?? undefined);
  });

  // 2) <source> dentro de <picture>: Idealista usa <picture> en la galería.
  $("source").each((_, el) => {
    const $el = $(el);
    const srcset = $el.attr("srcset");
    if (!srcset) return;
    // Toma todas las URLs del srcset; el dedupKey filtra duplicados de tamaño.
    for (const part of srcset.split(",")) {
      const url = part.trim().split(/\s+/)[0];
      consider(url);
    }
  });

  // 3) JSON-LD (schema.org/RealEstateListing suele incluir `image`).
  for (const obj of extractJsonLd($)) {
    for (const url of collectUrlStrings(obj)) consider(url);
  }

  // 4) __NEXT_DATA__ (Idealista lo usa en algunas vistas).
  const nextData = extractNextData($);
  if (nextData) {
    for (const url of collectUrlStrings(nextData)) consider(url);
  }

  // 5) Cualquier otro <script> con JSON inline que contenga URLs del CDN.
  // No parseamos: hacemos un match laxo en bruto y luego validamos.
  $('script:not([src])').each((_, el) => {
    const txt = $(el).contents().text();
    if (!txt || !txt.includes("idealista.")) return;
    const re = /https?:\/\/img\d*\.idealista\.[a-z]{2,3}\/[^\s"'<>)]+/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt)) !== null) {
      consider(m[0]);
    }
  });

  return collector.toArray();
}
