import * as cheerio from "cheerio";
import type { RawProperty, Scraper } from "../types";
import { extractFeaturesFromText } from "./level-real-estate";
import { extractMobiliaPhotos } from "./mobilia";

// Housingo (https://www.housingo.es) es una web ASP.NET/DNN (módulo InmobS3),
// pero expone listados COMPLETOS server-rendered en /es/venta y /es/alquiler
// (una tabla con todas las fichas, sin paginación). Las fichas se sirven en
// /es/{venta|alquiler}/ref-{N}. Las fotos vienen de Mobilia (mismo CDN que
// Level) → reutilizamos extractMobiliaPhotos.
//
// Criterios de captación (decididos con BC):
//   • Alquiler: solo desde 3.000 €/mes.
//   • Venta: cualquier precio.
//   • Ambos: solo zonas premium Salamanca, Chamberí, Retiro y Pozuelo.
//   • Solo viviendas (se descartan garajes, trasteros, locales, etc.).
const SITE_BASE = "https://www.housingo.es";
const USER_AGENT = "smartbc-bot/1.0 (contacto@bcousinoprop.com)";
const REQUEST_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 20000;
// Tope de fichas a scrapear por run (acota el tiempo). listExternalIds() NO se
// limita, así que el diff engine nunca archiva las que un run no alcance.
const DEFAULT_LIMIT = Number(process.env.HOUSINGO_SYNC_LIMIT ?? 400);
const RENT_MIN_PRICE = 3000;

// Zona (columna del listado, ej. "Madrid (Distrito Salamanca)") → etiqueta.
const ALLOWED_ZONES: Array<{ match: RegExp; label: string }> = [
  { match: /salamanca/i, label: "Salamanca" },
  { match: /chamber[íi]/i, label: "Chamberí" },
  { match: /retiro/i, label: "Retiro" },
  { match: /pozuelo/i, label: "Pozuelo" },
];

// Tipos NO residenciales que se descartan (ruido para un CRM de viviendas).
const EXCLUDED_TYPES = /garaje|trastero|plaza|local|oficina|nave|terreno|solar|parking/i;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// "1.950.000 €", "3.000 €/mes", "45.000 €" → número entero.
function parsePriceText(raw: string): number {
  const cleaned = raw.replace(/[^\d.]/g, "").replace(/\./g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function zoneLabel(zonaText: string): string | null {
  for (const z of ALLOWED_ZONES) {
    if (z.match.test(zonaText)) return z.label;
  }
  return null;
}

function firstInt(raw: string): number {
  const m = raw.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

// Las descripciones de Housingo vienen con su propia marca ("HousinGo presenta
// …", "HousinGo, by David de Gea. Somos una agencia…"), teléfonos y llamadas a
// la acción. BC republica las fichas como propias, así que hay que sanear todo
// eso para no confundir al cliente final ni promocionar a la competencia.
const PROMO_SENTENCE =
  /(somos una agencia|agencia inmobiliaria|especializad|ll[aá]m[ae]|ll[aá]menos|cont[aá]ct|no dude|no dudes|escr[ií]ban|wh?atsapp|vis[ií]ten?os|ven a vernos|gestionamos|ponte en contacto|m[aá]s informaci[oó]n|concertar (una )?(visita|cita)|@|www\.|https?:\/\/|\b[\w.-]+\.(es|com|net)\b)/i;

export function cleanHousingoDescription(raw: string): string {
  if (!raw) return "";
  let text = raw;

  // 1) Quitar el nombre de la agencia y sus muletillas ("HousinGo presenta",
  //    "HousinGo, by David de Gea.").
  text = text.replace(/housin\s?go\s*,?\s*by[^.!?]*[.!?]/gi, " ");
  text = text.replace(/housin\s?go\s+presenta\b/gi, " ");
  text = text.replace(/housin\s?go/gi, " ");
  // Nombre del titular que aparece en la marca.
  text = text.replace(/david de gea/gi, " ");

  // 2) Quitar teléfonos y prefijos.
  text = text.replace(/\+?\d[\d\s.\-]{7,}\d/g, " ");

  // 3) Separar frases pegadas ("reformado.Somos" → "reformado. Somos") para
  //    poder descartar las de promo/contacto.
  text = text.replace(/([.!?])([A-ZÁÉÍÓÚÑ¡¿])/g, "$1 $2");
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !PROMO_SENTENCE.test(s));
  text = sentences.join(" ");

  // 4) Limpiar espacios y signos sueltos al principio.
  text = text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/^[\s,.;:!¡?¿)\-]+/, "")
    .trim();
  // Capitalizar la primera letra si quedó en minúscula.
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type Entry = {
  ref: string;
  url: string;
  operation: "rent" | "sale";
  zone: string;
  price: number;
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  squareMeters?: number;
};

// Enumera (barato, 2 peticiones) las fichas de zonas premium leyendo la tabla
// de /es/venta y /es/alquiler. La tabla trae ref/tipo/zona/precio/m²/hab/baños,
// así que el filtrado (zona + precio + tipo) se hace aquí sin abrir fichas.
async function listEntries(): Promise<Entry[]> {
  const entries: Entry[] = [];
  // Dedup GLOBAL por ref: un mismo inmueble puede aparecer en venta Y en
  // alquiler. external_id es único por (source, external_id) en BD, así que
  // solo nos quedamos con la primera aparición (venta) para no chocar.
  const seen = new Set<string>();

  for (const operation of ["sale", "rent"] as const) {
    const page = operation === "rent" ? "alquiler" : "venta";
    const html = await fetchText(`${SITE_BASE}/es/${page}`);
    if (!html) continue;
    const $ = cheerio.load(html);

    $("table tr").each((_, tr) => {
      const cells = $(tr)
        .find("td")
        .map((__, td) => $(td).text().replace(/\s+/g, " ").trim())
        .get();
      // Columnas: [etiqueta, Fecha, Ref, Tipo, Zona, Precio, Superficie, Dorm, Baños]
      if (cells.length < 8) return;
      const ref = cells[2];
      if (!/^\d+$/.test(ref) || seen.has(ref)) return; // salta cabecera/duplicados
      seen.add(ref);

      const propertyType = cells[3];
      if (EXCLUDED_TYPES.test(propertyType)) return; // solo viviendas
      const zone = zoneLabel(cells[4]);
      if (!zone) return; // solo zonas premium
      const price = parsePriceText(cells[5]);
      if (price <= 0) return;
      if (operation === "rent" && price < RENT_MIN_PRICE) return;

      const href =
        $(tr).find('a[href*="/ref-"]').attr("href") || `/es/${page}/ref-${ref}`;
      entries.push({
        ref,
        url: href.startsWith("http") ? href : `${SITE_BASE}${href}`,
        operation,
        zone,
        price,
        propertyType,
        bedrooms: firstInt(cells[7] ?? ""),
        bathrooms: firstInt(cells[8] ?? ""),
        squareMeters: firstInt(cells[6] ?? "") || undefined,
      });
    });
  }

  return entries;
}

// La ficha aporta lo que la tabla no tiene: título, descripción y fotos.
async function scrapeDetail(entry: Entry): Promise<RawProperty | null> {
  const html = await fetchText(entry.url);
  if (!html) return null;
  const $ = cheerio.load(html);

  const title = $("h1").first().text().trim() || `Inmueble ${entry.ref}`;
  const rawDescription = $(".IDDescripcionBig")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  // Saneamos: fuera nombre de la agencia, teléfonos y autopromo/contacto.
  const description = cleanHousingoDescription(rawDescription);
  // Fotos servidas por Mobilia (media.mobiliagestion.es), acotadas a esta
  // propiedad. extractMobiliaPhotos las pasa a la versión `-original` limpia.
  const photos = extractMobiliaPhotos($, {
    pathMustInclude: `/Images/${entry.ref}/`,
  });

  const isTemporada = /temporada/i.test(`${title} ${description}`);
  const stay =
    entry.operation === "rent" ? (isTemporada ? "short" : "long") : undefined;

  return {
    externalId: entry.ref,
    sourceUrl: entry.url,
    title,
    description: description || undefined,
    operation: entry.operation,
    stay,
    propertyType: entry.propertyType,
    price: entry.price,
    bedrooms: entry.bedrooms,
    bathrooms: entry.bathrooms,
    squareMeters: entry.squareMeters,
    zone: entry.zone,
    features: extractFeaturesFromText(description),
    photos,
  };
}

export const housingoScraper: Scraper = {
  key: "housingo",
  label: "Housingo (web pública)",
  agencySlug: "housingo",
  scrape: async () => {
    const entries = await listEntries();
    const sliced = entries.slice(0, Math.max(1, DEFAULT_LIMIT));
    const results: RawProperty[] = [];
    for (let i = 0; i < sliced.length; i++) {
      try {
        const prop = await scrapeDetail(sliced[i]);
        if (prop) results.push(prop);
      } catch {
        // fallos individuales se ignoran; el sync log refleja el agregado
      }
      if (i < sliced.length - 1) await delay(REQUEST_DELAY_MS);
    }
    return results;
  },
  listExternalIds: async () => {
    const entries = await listEntries();
    return entries.map((e) => e.ref);
  },
};
