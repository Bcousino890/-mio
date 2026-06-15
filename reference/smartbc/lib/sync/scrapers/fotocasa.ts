import type { CheerioAPI } from "cheerio";
import type { RawPhoto } from "../types";
import {
  PhotoCollector,
  collectUrlStrings,
  extractJsonLd,
  extractNextData,
  isLikelyNonPhoto,
  pickBestImgVariant,
  resolveUrl,
} from "./image-utils";

// Reglas de imagen para Fotocasa (fotocasa.es). El CDN principal es
// `static.fotocasa.es` y vecinos `image.fotocasa.es`, `images.fotocasa.es`.
// Las fotos de galería suelen venir en <source srcset> dentro de <picture>
// y también dentro del bloque __NEXT_DATA__.

const FOTOCASA_HOST_RE = /(?:^|\/\/)(?:static|image|images|cdn|media)\.fotocasa\.[a-z.]+/i;

// Tokens de tamaño/calidad que aparecen en la URL de Fotocasa.
// Buscamos cambiar a la versión grande conocida cuando sea posible.
const FOTOCASA_SIZE_TOKENS: { from: RegExp; to: string }[] = [
  // /380x270/ → /1280x720/
  { from: /\/\d{2,4}x\d{2,4}\//, to: "/1280x720/" },
];

// Patrón seguro de path para fotos REALES del anuncio en Fotocasa. En
// Fotocasa, `/images/ads/<uuid>` y `/images/client/<uuid>` son las fotos
// de la propiedad publicada. Tratarlas como fotos seguras nos permite
// saltar el filtro genérico `isLikelyNonPhoto`, que descarta cualquier URL
// que contenga "ads" (pensado para filtrar banners de advertising, pero
// que aquí confunde "ads" = anuncios con "ads" = ads publicitarios).
const FOTOCASA_PHOTO_PATH_RE = /\/images\/(?:ads|client)\/[^?#]+/i;

export function isFotocasaImageUrl(url: string): boolean {
  if (!url) return false;
  if (!FOTOCASA_HOST_RE.test(url)) return false;
  // Path de fotos del anuncio: aceptar directamente sin pasar por el
  // filtro genérico (que rechaza la palabra "ads"). Las URLs aquí no
  // tienen por qué tener extensión .jpg/.png — Fotocasa negocia el
  // content-type con el header Accept.
  if (FOTOCASA_PHOTO_PATH_RE.test(url)) return true;
  // Cualquier otra cosa en host Fotocasa pasa por el filtro genérico
  // (logos, iconos, mapas, banners) y luego por la comprobación de
  // extensión clásica.
  if (isLikelyNonPhoto(url)) return false;
  if (/\/assets\//i.test(url)) return false;
  if (/\/maps?\//i.test(url)) return false;
  return /\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(url);
}

/**
 * Normaliza una URL de Fotocasa a su versión de mayor calidad:
 * - Las URLs nuevas usan `?rule=web_NxM_ar` o `?rule=original`. Forzamos
 *   `rule=original` para todos los UUIDs de `/images/ads/` y
 *   `/images/client/`, así dos size-variants del mismo UUID se deduplican
 *   y nos quedamos con la grande.
 * - Las URLs antiguas exponen `/<ancho>x<alto>/` en el path. Sustituimos
 *   por `/1280x720/` cuando aparece.
 */
export function toFotocasaHighQuality(url: string): string {
  let out = url;
  // (1) Path segment `/NNNxMMM/` → `/1280x720/`.
  for (const rule of FOTOCASA_SIZE_TOKENS) {
    if (rule.from.test(out) && !out.includes(rule.to)) {
      out = out.replace(rule.from, rule.to);
    }
  }
  // (2) Query `rule=...` → `rule=original` para uniformar todas las
  //     variantes (`web_412x257`, `web_580x387_ar`, etc.) al original.
  if (/[?&]rule=/i.test(out)) {
    out = out.replace(/([?&])rule=[^&]+/i, "$1rule=original");
  }
  return out;
}

export function extractFotocasaPhotos(
  $: CheerioAPI,
  baseUrl?: string,
): RawPhoto[] {
  const collector = new PhotoCollector();

  const consider = (raw: string | null | undefined, alt?: string) => {
    const resolved = resolveUrl(raw ?? undefined, baseUrl);
    if (!resolved) return;
    if (!isFotocasaImageUrl(resolved)) return;
    // `addTrusted`: ya hemos validado con `isFotocasaImageUrl`, que sabe
    // distinguir `/images/ads/` (fotos del anuncio) de banners reales. El
    // `add` genérico rechazaría por la palabra "ads" en la URL.
    collector.addTrusted(toFotocasaHighQuality(resolved), alt);
  };

  // 1) <img> (incluye lazy data-src/data-original).
  $("img").each((_, el) => {
    const $el = $(el);
    const best = pickBestImgVariant($el);
    consider(best, $el.attr("alt") ?? undefined);
  });

  // 2) <source> dentro de <picture> — galería principal usa este patrón.
  $("source").each((_, el) => {
    const $el = $(el);
    const srcset = $el.attr("srcset") ?? $el.attr("data-srcset");
    if (!srcset) return;
    for (const part of srcset.split(",")) {
      const url = part.trim().split(/\s+/)[0];
      consider(url);
    }
  });

  // 3) __NEXT_DATA__: Fotocasa expone `realEstate.multimedias[].url`.
  const nextData = extractNextData($);
  if (nextData) {
    for (const url of collectUrlStrings(nextData)) consider(url);
  }

  // 4) JSON-LD por si la ficha tiene RealEstateListing.
  for (const obj of extractJsonLd($)) {
    for (const url of collectUrlStrings(obj)) consider(url);
  }

  // 5) Otros <script> inline con bloques JSON que referencien el CDN.
  $('script:not([src])').each((_, el) => {
    const txt = $(el).contents().text();
    if (!txt || !txt.includes("fotocasa")) return;
    const re = /https?:\/\/(?:static|image|images|cdn|media)\.fotocasa\.[a-z.]+\/[^\s"'<>)]+/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt)) !== null) {
      consider(m[0]);
    }
  });

  return collector.toArray();
}
