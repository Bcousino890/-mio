// Verifica en local qué fotos saca el scraper para una propiedad de Level
// (sin tocar BD). Útil para confirmar que la regla Mobilia limpia la marca
// de agua antes de hacer un sync real.
//
// Uso:
//   node scripts/test-level-scrape.mjs                    # ref 4604 por defecto
//   node scripts/test-level-scrape.mjs 4604
//   node scripts/test-level-scrape.mjs propiedad-ref-4604-atico-salamanca
//
// Imprime cada URL que el scraper guardaría en BD. Si todas terminan en
// `-original.jpg`, la marca de agua queda fuera.

import * as cheerio from "cheerio";

const SITE_BASE = "https://levelrealestate.es";
const SITEMAP_URL = `${SITE_BASE}/property-sitemap.xml`;
const USER_AGENT = "smartbc-bot/1.0 (test-mobilia)";
const MOBILIA_HOST = "media.mobiliagestion.es";

function isMobiliaImageUrl(url) {
  if (!url) return false;
  if (!url.includes(MOBILIA_HOST)) return false;
  if (!url.includes("/Images/")) return false;
  if (url.includes("Flags")) return false;
  return /\.jpg(?:$|[?#])/i.test(url);
}

function toMobiliaOriginal(url) {
  if (/-original\.jpg(?:$|[?#])/i.test(url)) return url;
  return url.replace(/\.jpg(?=$|[?#])/i, "-original.jpg");
}

function extractMobiliaPhotos($, { pathMustInclude } = {}) {
  const seen = new Set();
  const photos = [];
  $("img").each((_, el) => {
    const $el = $(el);
    const dataOriginal = $el.attr("data-original");
    const dataSrc = $el.attr("data-src");
    const src = $el.attr("src");
    const srcset = $el.attr("srcset");
    const firstSrcset = srcset
      ? srcset.split(",")[0]?.trim().split(/\s+/)[0]
      : undefined;
    const ordered = [dataOriginal, dataSrc, src, firstSrcset];
    let chosen;
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

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.text();
}

async function resolveUrl(arg) {
  if (arg.startsWith("http")) return arg;
  if (arg.includes("/")) return `${SITE_BASE}/${arg.replace(/^\//, "")}`;

  // Solo número → buscamos en el sitemap la URL que contiene `propiedad-ref-N`.
  const ref = arg;
  const xml = await fetchText(SITEMAP_URL);
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const loc = m[1].trim();
    if (loc.includes(`propiedad-ref-${ref}/`) || loc.includes(`propiedad-ref-${ref}-`)) {
      return loc;
    }
  }
  throw new Error(`No encuentro la ref ${ref} en el sitemap`);
}

async function main() {
  const arg = process.argv[2] ?? "4604";
  console.log(`→ Resolviendo URL para "${arg}"...`);
  const url = await resolveUrl(arg);
  console.log(`✓ ${url}`);

  const refMatch = url.match(/propiedad-ref-(\d+)/);
  const ref = refMatch ? refMatch[1] : null;
  if (!ref) throw new Error("No puedo extraer la ref de la URL");

  console.log(`→ Descargando ficha (ref ${ref})...`);
  const html = await fetchText(url);
  const $ = cheerio.load(html);

  const title = $("h1.elementor-heading-title").first().text().trim();
  console.log(`✓ Título: ${title || "(sin título)"}`);

  const photos = extractMobiliaPhotos($, { pathMustInclude: `/Images/${ref}/` });
  console.log(`\n📷 ${photos.length} fotos que se guardarían en BD:`);
  for (const p of photos) {
    const watermarked = !p.url.includes("-original.jpg");
    const marker = watermarked ? "⚠️  CON marca de agua" : "✅ sin marca de agua";
    console.log(`   ${marker}  ${p.url}`);
  }

  const allClean = photos.every((p) => p.url.includes("-original.jpg"));
  console.log(
    allClean
      ? "\n✅ Todas las URLs apuntan a la versión `-original.jpg` (sin watermark)."
      : "\n⚠️  Hay URLs sin transformar — revisar la regla.",
  );
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
