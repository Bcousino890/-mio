import type { RawPhoto, RawProperty, Scraper } from "../types";

// UrbantecHome (https://urbantechome.com) es una SPA: sus datos vienen de la API
// pública `/api/rooms` (array con TODAS las viviendas). Por eso no scrapeamos
// HTML — pedimos la API una vez y mapeamos.
//
// Criterios de captación (decididos con BC):
//   • Solo ALQUILER (no tienen venta).
//   • CUALQUIER precio (tienen colaboración con nosotros sin mínimo).
//   • Solo zonas premium: Salamanca, Chamberí, Retiro, Chamartín, Pozuelo.
//     UrbantecHome no expone el distrito, así que lo derivamos del código postal.
//   • No quitan los pisos ocupados: dejan la fecha "disponible desde". La
//     calculamos a partir de su calendario de fechas `ocupadas`.
const API_URL = "https://urbantechome.com/api/rooms";
const IMAGE_BASE = "https://urbantechome.com/Imagenes_habitaciones/";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const REQUEST_TIMEOUT_MS = 25_000;
// Tope de fotos por ficha: el diff engine re-aloja las fotos EN SERIE, así que
// con ~55 viviendas de 30-46 fotos el primer sync sería larguísimo. 25 fotos
// son una galería de sobra.
const MAX_PHOTOS = 25;

// Código postal (3 primeros + completo) → distrito. Los CP de Madrid no son 1:1
// con el distrito, pero para las zonas premium que nos interesan basta. Los CP
// que NO estén aquí quedan fuera (no es zona objetivo).
const CP_ZONE: Record<string, string> = {
  // Salamanca
  "28001": "Salamanca",
  "28006": "Salamanca",
  "28028": "Salamanca",
  // Chamberí
  "28003": "Chamberí",
  "28010": "Chamberí",
  "28015": "Chamberí",
  // Retiro
  "28007": "Retiro",
  "28009": "Retiro",
  "28014": "Retiro",
  // Chamartín
  "28002": "Chamartín",
  "28016": "Chamartín",
  "28036": "Chamartín",
  "28046": "Chamartín",
  // Pozuelo de Alarcón
  "28223": "Pozuelo",
  "28224": "Pozuelo",
};

type Room = Record<string, unknown>;

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}
function num(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^\d.,-]/g, "").replace(",", "."));
    return isFinite(n) ? n : undefined;
  }
  return undefined;
}

function postalCode(room: Room): string | null {
  const blob = `${str(room.codigo_postal) ?? ""} ${str(room.cp) ?? ""} ${str(room.direccion) ?? ""}`;
  const m = blob.match(/\b(28\d{3})\b/);
  return m ? m[1] : null;
}

function zoneFor(room: Room): string | null {
  const cp = postalCode(room);
  return cp ? (CP_ZONE[cp] ?? null) : null;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ntilde;/gi, "ñ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Fuera toda mención al portal de origen.
function sanitize(text: string): string {
  return text
    .replace(/urbantec\s*home/gi, "")
    .replace(/\burbantec\b/gi, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const IMG_RE = /\.(jpe?g|png|webp|avif)(\?|#|$)/i;

function toPhotoUrl(name: string): string {
  const t = name.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (/^Imagenes_habitaciones\//i.test(t)) return `https://urbantechome.com/${t}`;
  const file = t.split("/").pop() ?? t;
  return `${IMAGE_BASE}${file}`;
}

function extractPhotos(room: Room): RawPhoto[] {
  const fields = ["fotos", "photos", "imagenes_habitaciones", "imagenes", "images", "gallery"];
  let raw: unknown[] = [];
  for (const f of fields) {
    const v = room[f];
    if (Array.isArray(v) && v.length > 0) {
      raw = v;
      break;
    }
  }
  const seen = new Set<string>();
  const out: RawPhoto[] = [];
  for (const item of raw) {
    const name = typeof item === "string" ? item : null;
    if (!name) continue;
    const url = toPhotoUrl(name);
    if (!IMG_RE.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url });
    if (out.length >= MAX_PHOTOS) break;
  }
  return out;
}

function extractFeatures(room: Room): string[] {
  const feats: string[] = [];
  const add = (cond: unknown, label: string) => {
    if (
      cond === true ||
      cond === "true" ||
      (typeof cond === "string" && cond.trim() && !/^(false|no|sin)$/i.test(cond.trim()))
    ) {
      feats.push(label);
    }
  };
  add(room.con_ascensor ?? room.ascensor, "Ascensor");
  add(room.amueblado ?? room.furnished, "Amueblado");
  add(room.aire_acondicionado, "Aire acondicionado");
  add(room.calefaccion, "Calefacción");
  add(room.terrace ?? room.terraza, "Terraza");
  add(room.balcon, "Balcón");
  add(room.smart_tv ?? room.smartTv, "Smart TV");
  add(room.puerta_seguridad ?? room.puertaSeguridad, "Puerta de seguridad");
  add(room.armario_empotrado ?? room.armarioEmpotrado, "Armario empotrado");
  add(room.portero ?? room.conserje, "Portero");
  return [...new Set(feats)];
}

function addDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// "Disponible desde": si está ocupada HOY, devolvemos el primer día libre tras
// el bloque ocupado contiguo. Si hoy está libre, no devolvemos nada (disponible
// ya). Las fechas vienen del calendario `ocupadas`.
function availableFrom(room: Room, todayIso: string): string | undefined {
  const occ = room.ocupadas;
  if (!Array.isArray(occ) || occ.length === 0) return undefined;
  const set = new Set(occ.filter((d): d is string => typeof d === "string"));
  if (!set.has(todayIso)) return undefined;
  let d = todayIso;
  // Cota de seguridad por si el calendario es enorme/no contiguo.
  for (let i = 0; i < 1100 && set.has(d); i++) d = addDay(d);
  return d;
}

function sourceUrlFor(id: string): string {
  return `https://urbantechome.com/habitacionx.html?id=${id}`;
}

async function fetchRooms(): Promise<Room[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as Room[]) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Solo viviendas en zona objetivo y con id + fotos.
function targetRooms(rooms: Room[]): Array<{ room: Room; zone: string; id: string }> {
  const out: Array<{ room: Room; zone: string; id: string }> = [];
  for (const room of rooms) {
    const id = str(room.id);
    if (!id) continue;
    const zone = zoneFor(room);
    if (!zone) continue; // fuera de zona premium
    out.push({ room, zone, id });
  }
  return out;
}

export const urbantechomeScraper: Scraper = {
  key: "urbantechome",
  label: "UrbantecHome (API pública)",
  agencySlug: "urbantechome",
  // Fotos limpias servidas desde su CDN: no re-alojamos (sync instantáneo). El
  // proxy /p/{slug}/{idx} neutraliza el origen al mostrarlas.
  rehostPhotos: false,
  scrape: async () => {
    const rooms = await fetchRooms();
    const today = new Date().toISOString().slice(0, 10);
    const results: RawProperty[] = [];
    for (const { room, zone, id } of targetRooms(rooms)) {
      const photos = extractPhotos(room);
      if (photos.length === 0) continue;
      const rawDesc = str(room.description) ?? str(room.description_short) ?? "";
      const description = rawDesc ? sanitize(stripTags(rawDesc)) || undefined : undefined;
      const isTemporada = /temporada|corta estancia|short/i.test(
        `${str(room.tipo_habitacion) ?? ""} ${description ?? ""}`,
      );
      results.push({
        externalId: id,
        sourceUrl: sourceUrlFor(id),
        title:
          str(room.title) ??
          (str(room.calle) ? `Piso en ${str(room.calle)}` : null) ??
          str(room.direccion) ??
          "Vivienda",
        description,
        operation: "rent",
        stay: isTemporada ? "short" : "long",
        propertyType: str(room.tipo_vivienda) ?? "Piso",
        price: num(room.precio) ?? num(room.price) ?? 0,
        bedrooms: num(room.numero_dormitorios) ?? num(room.bedrooms),
        bathrooms: num(room.numero_banos),
        squareMeters: num(room.tamano_m2) ?? num(room.superficie),
        zone,
        address: str(room.direccion) ?? undefined,
        availableFrom: availableFrom(room, today),
        features: extractFeatures(room),
        photos,
      });
    }
    return results;
  },
  // Autoridad de archivado: todas las refs en zona objetivo actualmente vivas.
  listExternalIds: async () => {
    const rooms = await fetchRooms();
    return targetRooms(rooms).map((t) => t.id);
  },
};
