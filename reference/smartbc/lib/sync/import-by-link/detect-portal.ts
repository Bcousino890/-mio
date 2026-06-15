import type { ImportPortal } from "./types";

// Detecta a qué portal pertenece un URL en base al hostname. Es defensivo:
// acepta www., subdominios y TLDs distintos (es / pt / it) del mismo portal.

const RULES: { match: (host: string) => boolean; portal: ImportPortal }[] = [
  {
    match: (h) => /(^|\.)idealista\.[a-z.]+$/i.test(h),
    portal: "idealista",
  },
  {
    match: (h) => /(^|\.)fotocasa\.[a-z.]+$/i.test(h),
    portal: "fotocasa",
  },
  {
    match: (h) => /(^|\.)inmoweb\.(es|net|com)$/i.test(h),
    portal: "inmoweb",
  },
  {
    match: (h) => h === "media.mobiliagestion.es",
    portal: "mobilia",
  },
  {
    match: (h) => /(^|\.)clikalia\.[a-z.]+$/i.test(h),
    portal: "clikalia",
  },
  {
    match: (h) => /(^|\.)urbantechome\.[a-z.]+$/i.test(h),
    portal: "urbantechome",
  },
];

export function detectPortal(rawUrl: string): {
  portal: ImportPortal;
  url: URL;
} | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  for (const rule of RULES) {
    if (rule.match(host)) return { portal: rule.portal, url };
  }
  return { portal: "generic", url };
}
