import * as cheerio from "cheerio";
import type { RawPhoto, RawProperty, Scraper } from "../types";
import { extractMobiliaPhotos } from "./mobilia";

const SITE_BASE = "https://levelrealestate.es";
const SITEMAP_URL = `${SITE_BASE}/property-sitemap.xml`;
const USER_AGENT =
  "smartbc-bot/1.0 (contacto@bencousinopropiedades.com)";
const REQUEST_DELAY_MS = 2500;
const REQUEST_TIMEOUT_MS = 20000;
// Límite por sync para no agotar el maxDuration del endpoint (300s). El primer
// sync completo se puede disparar localmente con LEVEL_SYNC_LIMIT=999 en env.
const DEFAULT_LIMIT = Number(process.env.LEVEL_SYNC_LIMIT ?? 25);

// Match parcial sobre la cadena completa de `property-location` (todos los
// segmentos, no solo el primero). Insensible a mayúsculas y acentos.
// El `label` es el nombre normalizado que se guarda en BD.
const ZONE_KEYWORDS: Array<{ match: RegExp; label: string }> = [
  { match: /salamanca/i, label: "Salamanca" },
  { match: /chamber[íi]/i, label: "Chamberí" },
  { match: /retiro/i, label: "Retiro" },
  { match: /pozuelo/i, label: "Pozuelo" },
  { match: /chamart[íi]n/i, label: "Chamartín" },
  { match: /chueca/i, label: "Chueca" },
  { match: /justicia/i, label: "Justicia" },
  { match: /moraleja/i, label: "La Moraleja" },
  { match: /centro/i, label: "Centro" },
];

// Lista de keywords (lowercase, sin acentos) que la propiedad DEBE contener
// en algún segmento de su ubicación para aceptarse. Si vacío, no filtra.
// Configurable vía `LEVEL_ALLOWED_ZONES=salamanca,chamberi,retiro,pozuelo`.
const ALLOWED_ZONE_KEYS = (process.env.LEVEL_ALLOWED_ZONES ?? "")
  .split(",")
  .map((s) =>
    s
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, ""),
  )
  .filter(Boolean);

// Features binarias del scraper: solo etiquetas con valor sí/no son útiles
// como chip en la UI. "Orientación" se omite porque su valor (N/S/E/O) no
// se almacena hoy en BD y un chip "Orientación" sin valor confunde.
const FEATURE_LABELS = new Set([
  "Terrazas",
  "Piscina",
  "Jardín",
  "Garaje",
  "Trastero",
  "Ascensor",
  "Aire acondicionado",
  "Calefacción",
  "Portero",
  "Reformado",
  "Amueblado",
]);

// Detección heurística de features desde la descripción libre. Level no
// publica las features en SSR (las carga por JS), así que la única fuente
// fiable y automática es el texto descriptivo. Cada regla mira una palabra
// clave razonablemente inequívoca; si encaja, añadimos la feature.
// IMPORTANTE: ante la duda, NO añadir. Mejor faltarle una que mentir.
const DESCRIPTION_FEATURE_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: "Reformado", pattern: /\breformad[oa]s?\b/i },
  { label: "Amueblado", pattern: /\bamueblad[oa]s?\b/i },
  { label: "Terraza", pattern: /\bterraza(s)?\b/i },
  { label: "Balcón", pattern: /\bbalc[oó]n(es)?\b/i },
  { label: "Aire acondicionado", pattern: /\baire acondicionad[oa]\b/i },
  { label: "Calefacción", pattern: /\bcalefacci[oó]n\b/i },
  { label: "Piscina", pattern: /\bpiscina\b/i },
  { label: "Jardín", pattern: /\bjard[ií]n(es)?\b/i },
  { label: "Garaje", pattern: /\b(garaje|plaza de garaje|parking)\b/i },
  { label: "Trastero", pattern: /\btrastero\b/i },
  { label: "Ascensor", pattern: /\bascensor(es)?\b/i },
  { label: "Portero", pattern: /\b(portero|conserje|conserjer[ií]a)\b/i },
  { label: "Vestidor", pattern: /\bvestidor(es)?\b/i },
  // "completamente equipada" es la frase comercial estándar para cocinas
  // de gama alta — más conservador que un genérico /cocina equipada/.
  { label: "Cocina equipada", pattern: /\b(completamente equipada|cocina equipada)\b/i },
  { label: "Armarios empotrados", pattern: /\barmarios (empotrados|de suelo a techo)\b/i },
  // "Baño en suite" requiere la frase completa: el genérico "suite" es
  // demasiado ambiguo (puede ser un baño dentro de la habitación principal,
  // no una "suite" en sí).
  { label: "Baño en suite", pattern: /\bba[ñn]os? en suite\b/i },
];

export function extractFeaturesFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const rule of DESCRIPTION_FEATURE_RULES) {
    if (rule.pattern.test(text)) found.add(rule.label);
  }
  return Array.from(found);
}

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
      redirect: "manual",
      cache: "no-store",
    });
    // Las propiedades retiradas devuelven 301 → home. Las consideramos no
    // disponibles y devolvemos null para que el caller las salte.
    if (res.status >= 300 && res.status < 400) return null;
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function refFromUrl(url: string): string | null {
  const match = url.match(/propiedad-ref-(\d+)\/?/);
  return match ? match[1] : null;
}

async function loadSitemapRefs(): Promise<
  Array<{ ref: string; url: string }>
> {
  const xml = await fetchText(SITEMAP_URL);
  if (!xml) return [];

  // Dedupe por ref: el sitemap de Level puede listar la misma propiedad en
  // dos URLs distintas (visto en mayo 2026 con ref 5379). Sin dedupe el
  // diff engine procesa la propiedad dos veces y el segundo INSERT falla
  // con "duplicate key violates properties_slug_key", dejando el sync en
  // partial.
  const seen = new Set<string>();
  const urls: Array<{ ref: string; url: string }> = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const url = m[1].trim();
    const ref = refFromUrl(url);
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    urls.push({ ref, url });
  }
  return urls;
}

function parsePriceText(raw: string): number {
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/€/g, "")
    .replace(/\./g, "")
    .replace(/,\d{0,2}$/, "")
    .trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function parseZone(raw: string | undefined): string {
  if (!raw) return "Madrid";
  // Probamos match parcial contra cualquier keyword conocida: devuelve el
  // label canónico (Salamanca, Chamberí, Pozuelo...). Si no matchea ninguna,
  // devolvemos el primer segmento tal cual viene.
  for (const { match, label } of ZONE_KEYWORDS) {
    if (match.test(raw)) return label;
  }
  return raw.split(",")[0]?.trim() ?? "Madrid";
}

function zoneIsAllowed(rawLocation: string | undefined): boolean {
  if (ALLOWED_ZONE_KEYS.length === 0) return true;
  if (!rawLocation) return false;
  const normalized = stripAccents(rawLocation).toLowerCase();
  return ALLOWED_ZONE_KEYS.some((kw) => normalized.includes(kw));
}

function parseFeatureList(
  $: cheerio.CheerioAPI,
): { bedrooms: number; bathrooms: number; sqm: number | null; features: string[] } {
  let bedrooms = 0;
  let bathrooms = 0;
  let sqm: number | null = null;
  const features = new Set<string>();

  // Level inserta en el HTML un bloque "Características" oculto en todas las
  // pantallas (triple clase `elementor-hidden-*`) que enumera TODAS las
  // amenidades posibles (Piscina, Jardín, Garaje, ...) con un valor
  // placeholder "3" — es una plantilla genérica, no las features reales del
  // piso. Si lo leyéramos, mostraríamos features que el piso NO tiene.
  // Por eso descartamos cualquier lista cuyo ancestor sea un contenedor
  // marcado como oculto en todas las pantallas.
  const isInHiddenBlock = (el: Parameters<cheerio.CheerioAPI>[0]): boolean => {
    return (
      $(el as Parameters<typeof $>[0]).closest(
        ".elementor-hidden-desktop.elementor-hidden-tablet.elementor-hidden-mobile",
      ).length > 0
    );
  };

  // Cada lista de iconos lleva sus pares label/value en una <ul>. Procesamos
  // por lista (no concatenando todas) para que el emparejamiento label/value
  // no se desincronice entre bloques.
  $(".elementor-icon-list-items").each((_, ul) => {
    if (isInHiddenBlock(ul)) return;

    const items = $(ul)
      .find(".elementor-icon-list-text")
      .map((_i, el) => $(el).text().trim())
      .get();

    for (let i = 0; i < items.length; i += 2) {
      const label = items[i];
      const value = items[i + 1] ?? "";

      if (label === "Dormitorios") {
        const n = parseInt(value, 10);
        if (Number.isFinite(n) && bedrooms === 0) bedrooms = n;
      } else if (label === "Baños") {
        const n = parseInt(value, 10);
        if (Number.isFinite(n) && bathrooms === 0) bathrooms = n;
      } else if (label === "Construido" || label === "Superficie") {
        const m = value.match(/([\d.,]+)\s*m/);
        if (m && sqm == null) {
          sqm = Math.round(Number(m[1].replace(",", ".")));
        }
      } else if (FEATURE_LABELS.has(label)) {
        // Solo cuenta como feature si el value es un número entero >= 1
        // (cantidad real, ej. "2" terrazas). Cualquier otra cosa (placeholder
        // tipo "3" del bloque oculto, "Sí"/"No", vacío) no se considera fiable.
        const n = parseInt(value, 10);
        if (Number.isFinite(n) && n >= 1) features.add(label);
      }
    }
  });

  return { bedrooms, bathrooms, sqm, features: Array.from(features) };
}

function detectOperation(
  classAttrs: string,
): { operation: "rent" | "sale"; stay: "short" | "long" | null } | null {
  if (classAttrs.includes("property_offer-alquiler-es")) {
    // Posibles taxonomías futuras: property_stay-corta vs property_stay-larga.
    // Por defecto larga estancia hasta que la web exponga el distinto.
    const isShort =
      classAttrs.includes("property_stay-corta") ||
      classAttrs.includes("temporada");
    return { operation: "rent", stay: isShort ? "short" : "long" };
  }
  if (classAttrs.includes("property_offer-venta-es")) {
    return { operation: "sale", stay: null };
  }
  return null;
}

// Diccionario para normalizar el slug de Yoast a un nombre legible. Si
// aparece un slug no listado, devolvemos el slug capitalizado.
const PROPERTY_TYPE_LABELS: Record<string, string> = {
  pisos: "Piso",
  piso: "Piso",
  aticos: "Ático",
  atico: "Ático",
  duplex: "Dúplex",
  chalets: "Chalet",
  chalet: "Chalet",
  villas: "Villa",
  villa: "Villa",
  estudios: "Estudio",
  estudio: "Estudio",
  locales: "Local",
  local: "Local",
  oficinas: "Oficina",
  oficina: "Oficina",
};

function detectPropertyType(classAttrs: string): string | null {
  const m = classAttrs.match(/property_type-([a-z-]+?)-es\b/);
  if (!m) return null;
  const slug = m[1];
  if (PROPERTY_TYPE_LABELS[slug]) return PROPERTY_TYPE_LABELS[slug];
  // Fallback: capitalizar el slug ("loft" → "Loft")
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function extractPhotos(
  $: cheerio.CheerioAPI,
  ref: string,
): RawPhoto[] {
  // Level sirve sus imágenes desde Mobilia. Delegamos en el helper común,
  // que valida dominio (`media.mobiliagestion.es`), descarta `Flags`,
  // recorre src/data-src/data-original/srcset y transforma a
  // `-original.jpg` (versión sin marca de agua). Limitamos al subpath
  // de la propiedad para no capturar galerías de fichas sugeridas.
  return extractMobiliaPhotos($, { pathMustInclude: `/Images/${ref}/` });
}

export async function scrapeProperty(
  url: string,
): Promise<RawProperty | null> {
  const html = await fetchText(url);
  if (!html) return null;

  const ref = refFromUrl(url);
  if (!ref) return null;

  const $ = cheerio.load(html);
  // Los slugs de taxonomía property_offer-* viven en un wrapper interno de
  // Elementor (no en <body>). Concatenamos cualquier class de los elementos
  // con la propia clase "property" para asegurar la detección.
  const classAttrs = $("[class*='property_offer-']")
    .map((_, el) => $(el).attr("class") ?? "")
    .get()
    .join(" ");

  const opInfo = detectOperation(classAttrs);
  if (!opInfo) return null;
  const propertyType = detectPropertyType(classAttrs);

  const locationText = $(".property-location").first().text().trim();
  // Filtro de zona: si LEVEL_ALLOWED_ZONES está activo y esta propiedad
  // no cumple, la descartamos antes de procesar fotos (lo costoso).
  if (!zoneIsAllowed(locationText)) return null;

  const title =
    $("h1.elementor-heading-title").first().text().trim() ||
    `Propiedad ${ref}`;
  const priceText = $(".property-price").first().contents().first().text();
  const price = parsePriceText(priceText);
  if (price <= 0) return null;

  const description = $("#propiedadcontenido")
    .text()
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const zone = parseZone(locationText);

  const { bedrooms, bathrooms, sqm, features: htmlFeatures } = parseFeatureList($);

  // Las listas de iconos en SSR no exponen las amenidades reales (Level las
  // carga por JS dinámico). Como fallback fiable, las inferimos de la
  // descripción con keywords claros. Si BC quiere afinar, puede añadir
  // features manuales desde el admin.
  const descriptionFeatures = extractFeaturesFromText(description);

  // Mantenemos las que sí extrajimos del HTML (cantidades reales de
  // terrazas/etc.) y añadimos las de la descripción, deduplicando.
  const features = Array.from(new Set([...htmlFeatures, ...descriptionFeatures]));

  const photos = extractPhotos($, ref);

  return {
    externalId: ref,
    sourceUrl: url,
    title,
    description: description || undefined,
    operation: opInfo.operation,
    stay: opInfo.stay ?? undefined,
    propertyType: propertyType ?? undefined,
    price,
    bedrooms,
    bathrooms,
    squareMeters: sqm ?? undefined,
    zone,
    features,
    photos,
  };
}

const HAS_ZONE_FILTER = ALLOWED_ZONE_KEYS.length > 0;

const scraperBase: Scraper = {
  key: "level-real-estate",
  label: "Level Real Estate (web pública)",
  agencySlug: "level-real-estate",
  scrape: async () => {
    const refs = await loadSitemapRefs();
    // Con filtro de zonas activo, ignoramos LIMIT: hay que abrir cada ficha
    // igualmente para conocer su zona y decidir si entra. Sin filtro, LIMIT
    // controla cuántas procesa cada sync (cron de 6h cubre el catálogo
    // poco a poco).
    const sliced = HAS_ZONE_FILTER
      ? refs
      : refs.slice(0, Math.max(1, DEFAULT_LIMIT));
    const results: RawProperty[] = [];

    for (let i = 0; i < sliced.length; i++) {
      const { url } = sliced[i];
      try {
        const prop = await scrapeProperty(url);
        if (prop) results.push(prop);
      } catch {
        // ignorar fallos individuales; el sync log refleja el total agregado
      }
      // Rate limit cortés excepto la última iteración
      if (i < sliced.length - 1) await delay(REQUEST_DELAY_MS);
    }

    return results;
  },
};

// `listExternalIds()` SOLO se expone cuando no hay filtro de zonas. Con
// filtro activo no podemos saber qué refs pasan sin abrir la ficha, así que
// el motor cae al modo legacy (usar `seenExternal` como autoridad).
if (!HAS_ZONE_FILTER) {
  scraperBase.listExternalIds = async () => {
    const refs = await loadSitemapRefs();
    return refs.map((r) => r.ref);
  };
}

export const levelRealEstateScraper: Scraper = scraperBase;
