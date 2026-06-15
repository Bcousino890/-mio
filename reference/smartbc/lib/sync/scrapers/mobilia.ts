import type { CheerioAPI } from "cheerio";
import type { RawPhoto } from "../types";

// Reglas de imagen para sitios que sirven media desde Mobilia
// (media.mobiliagestion.es). Sirven tanto para Level Real Estate como
// para cualquier otra agencia que use el mismo backend. La transformación
// `.jpg → -original.jpg` devuelve la versión sin marca de agua.

const MOBILIA_HOST = "media.mobiliagestion.es";

export function isMobiliaImageUrl(url: string): boolean {
  if (!url) return false;
  if (!url.includes(MOBILIA_HOST)) return false;
  if (!url.includes("/Images/")) return false;
  if (url.includes("Flags")) return false;
  // Acepta .jpg al final del path o antes de querystring/fragment.
  return /\.jpg(?:$|[?#])/i.test(url);
}

export function toMobiliaOriginal(url: string): string {
  if (/-original\.jpg(?:$|[?#])/i.test(url)) return url;
  return url.replace(/\.jpg(?=$|[?#])/i, "-original.jpg");
}

type ExtractOptions = {
  // Si se pasa, solo aceptamos URLs cuyo path contenga este fragmento
  // (típicamente `/Images/<ref>/` para descartar galerías de propiedades
  // sugeridas en la misma página).
  pathMustInclude?: string;
};

/**
 * Recorre las `<img>` del documento (o del scope dado) y devuelve las
 * fotos válidas según las reglas de Mobilia: dominio correcto, `/Images/`,
 * extensión `.jpg`, sin `Flags`, transformadas a `-original.jpg` y
 * deduplicadas. Considera `src`, `data-src`, `data-original` y `srcset`.
 */
export function extractMobiliaPhotos(
  $: CheerioAPI,
  options: ExtractOptions = {},
): RawPhoto[] {
  const { pathMustInclude } = options;
  const seen = new Set<string>();
  const photos: RawPhoto[] = [];

  $("img").each((_, el) => {
    const $el = $(el);
    // Cada `<img>` representa UNA foto. `src`, `data-src`, `data-original` y
    // `srcset` son distintas variantes (tamaños / lazy-load) del mismo recurso.
    // Elegimos UNA sola en orden de preferencia: data-original > data-src >
    // src > primer entry de srcset. Así evitamos generar URLs inexistentes
    // tipo `XXX-thumb-original.jpg` cuando el srcset incluye thumbs.
    const dataOriginal = $el.attr("data-original");
    const dataSrc = $el.attr("data-src");
    const src = $el.attr("src");
    const srcset = $el.attr("srcset");
    const firstSrcset = srcset
      ? srcset.split(",")[0]?.trim().split(/\s+/)[0]
      : undefined;

    const ordered = [dataOriginal, dataSrc, src, firstSrcset];
    let chosen: string | undefined;
    for (const candidate of ordered) {
      if (candidate && isMobiliaImageUrl(candidate)) {
        if (pathMustInclude && !candidate.includes(pathMustInclude)) continue;
        chosen = candidate;
        break;
      }
    }
    if (!chosen) return;

    const normalized = toMobiliaOriginal(chosen);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    photos.push({ url: normalized, alt: $el.attr("alt") ?? undefined });
  });

  return photos;
}
