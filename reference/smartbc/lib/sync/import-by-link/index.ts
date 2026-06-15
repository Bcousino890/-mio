import "server-only";
import * as cheerio from "cheerio";
import { detectPortal } from "./detect-portal";
import { fetchHtml } from "./fetch-html";
import { extractClikalia, normalizeClikaliaUrl } from "./extractors/clikalia";
import { extractUrbantechome } from "./extractors/urbantechome";
import { extractFotocasa } from "./extractors/fotocasa";
import { extractGeneric } from "./extractors/generic";
import { extractIdealista } from "./extractors/idealista";
import { extractInmoweb } from "./extractors/inmoweb";
import { dedupKey } from "../scrapers/image-utils";
import type { ImportExtractResult, ImportPreview } from "./types";

export type { ImportPreview, ImportPortal, ImportPhoto } from "./types";

// Identidad de una foto para deduplicar el preview. Algunos portales sirven la
// MISMA foto bajo varias URLs (distinto tamaño/perfil, o shards de CDN como
// img1/img3.idealista.com), y se colaban dos veces en la pantalla de importar.
//  - Idealista: la identidad es el HASH del último segmento del path (idéntico
//    en todos los tamaños y shards), así que normalizamos host+perfil a ese hash.
//  - Resto: dedupKey (url sin params volátiles). No usamos el basename a secas
//    porque en webs genéricas dos fotos distintas pueden compartir nombre
//    (/habitacion1/foto.jpg vs /habitacion2/foto.jpg) y las fusionaría.
function photoIdentity(url: string): string {
  try {
    const u = new URL(url);
    if (/(?:^|\.)idealista\.com$/i.test(u.hostname)) {
      const seg = u.pathname.split("/").filter(Boolean).pop();
      // Hash de la foto sin extensión: misma foto como .jpg/.webp comparte hash.
      if (seg) {
        return "idealista:" + seg.toLowerCase().replace(/\.(?:jpe?g|png|webp)$/i, "");
      }
    }
  } catch {
    return url;
  }
  return dedupKey(url);
}

// Red de seguridad común a TODOS los portales: quita fotos repetidas del preview
// antes de devolverlo, conservando el orden (la primera aparición gana).
function dedupePreviewPhotos(preview: ImportPreview): ImportPreview {
  const seen = new Set<string>();
  const photos = preview.photos.filter((p) => {
    const k = photoIdentity(p.url);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return photos.length === preview.photos.length
    ? preview
    : { ...preview, photos };
}

/**
 * Punto de entrada: dado un URL público, descarga el HTML y devuelve una
 * preview completa. NO inserta nada en BD. NO descarga fotos. La preview
 * lleva URLs originales del portal; el watermarking se hace después al
 * confirmar.
 */
export async function extractFromUrl(
  rawUrl: string,
): Promise<ImportExtractResult> {
  const detected = detectPortal(rawUrl);
  if (!detected) {
    return {
      ok: false,
      error: {
        kind: "unsupported_url",
        reason: "URL inválida o esquema no soportado (solo http/https)",
      },
    };
  }

  // UrbantecHome es una SPA: los datos NO están en el HTML, vienen de su API
  // pública. No descargamos HTML; el extractor consulta la API directamente.
  if (detected.portal === "urbantechome") {
    try {
      return {
        ok: true,
        preview: dedupePreviewPhotos(
          await extractUrbantechome(detected.url.toString()),
        ),
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: "parse_failed",
          reason:
            err instanceof Error ? err.message : "urbantechome_extract_failed",
        },
      };
    }
  }

  // Clikalia: forzamos la ficha en español para parsear los datos en el idioma
  // correcto, sea cual sea el idioma del link pegado.
  if (detected.portal === "clikalia") {
    detected.url = normalizeClikaliaUrl(detected.url);
  }

  const fetched = await fetchHtml(detected.url.toString());
  if (!fetched.ok) return { ok: false, error: fetched.error };

  const $ = cheerio.load(fetched.html);
  const finalUrl = fetched.finalUrl;

  switch (detected.portal) {
    case "idealista":
      return { ok: true, preview: dedupePreviewPhotos(await extractIdealista($, finalUrl, { proxyUrl: process.env.SMARTPROXY_URL })) };
    case "fotocasa":
      return { ok: true, preview: dedupePreviewPhotos(extractFotocasa($, finalUrl)) };
    case "inmoweb":
      return { ok: true, preview: dedupePreviewPhotos(extractInmoweb($, finalUrl)) };
    case "clikalia":
      return { ok: true, preview: dedupePreviewPhotos(extractClikalia($, finalUrl)) };
    case "mobilia":
    case "generic":
    default:
      return {
        ok: true,
        preview: dedupePreviewPhotos(extractGeneric($, finalUrl, detected.portal)),
      };
  }
}
