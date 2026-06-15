import "server-only";
import type { ImportPhoto, ImportPreview } from "../types";

// Extractor para urbantechome.com. Es una SPA: el HTML no trae datos; la ficha
// se rellena en el navegador desde su API pública `/api/rooms` (un array con
// todas las viviendas). Así que NO usamos el HTML — pedimos la API y buscamos
// la vivienda por el `id` del enlace (?id=...).
//
// Las fotos del API son nombres de archivo sueltos (ej. "habitacion-123.webp")
// que el front sirve desde `/Imagenes_habitaciones/`.

const API_URL = "https://urbantechome.com/api/rooms";
const IMAGE_BASE = "https://urbantechome.com/Imagenes_habitaciones/";

type Room = Record<string, unknown>;

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^\d.,-]/g, "").replace(",", "."));
    return isFinite(n) ? n : null;
  }
  return null;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ntilde;/gi, "ñ")
    .replace(/\s+/g, " ")
    .trim();
}

// Quita la marca del portal de la descripción (requisito: los pisos no deben
// mencionar la fuente).
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

// Replica la lógica de getAllPhotosFromRoom del front: usa `fotos` si existe,
// si no cae a `photos`/`imagenes`/etc. Normaliza a URLs absolutas de imagen.
function extractPhotos(room: Room): ImportPhoto[] {
  const fields = ["fotos", "photos", "imagenes_habitaciones", "imagenes", "images", "gallery"];
  let raw: unknown[] = [];
  for (const f of fields) {
    const v = room[f];
    if (Array.isArray(v) && v.length > 0) {
      raw = v;
      break;
    }
    if (typeof v === "string" && v.trim()) {
      raw = [v];
      break;
    }
  }
  const seen = new Set<string>();
  const out: ImportPhoto[] = [];
  for (const item of raw) {
    const name =
      typeof item === "string"
        ? item
        : typeof item === "object" && item
          ? ((item as Record<string, unknown>).url as string) ??
            ((item as Record<string, unknown>).src as string)
          : null;
    if (!name || typeof name !== "string") continue;
    const url = toPhotoUrl(name);
    if (!IMG_RE.test(url)) continue; // descarta PDFs/planos
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url });
  }
  return out;
}

// Mapea los campos booleanos/valor del API a etiquetas de características.
function extractFeatures(room: Room): string[] {
  const feats: string[] = [];
  const add = (cond: unknown, label: string) => {
    if (cond === true || cond === "true" || (typeof cond === "string" && cond.trim() && cond !== "false" && cond !== "sin")) {
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
  add(room.agua_caliente ?? room.aguaCaliente, "Agua caliente central");
  return [...new Set(feats)];
}

// Normaliza a NFC (un acento puede venir en NFD desde el portapapeles de Mac y
// no casaría con el NFC del API aunque se vean idénticos).
function nfc(s: string): string {
  return s.normalize("NFC");
}
// Versión "plegada": sin acentos y en minúsculas, para un emparejamiento
// tolerante como último recurso.
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function findRoom(rooms: Room[], id: string): Room | null {
  const nId = nfc(id);
  const exact = rooms.find((r) => nfc(str(r.id) ?? "") === nId);
  if (exact) return exact;
  // Por detail_page (?id=...).
  const byPage = rooms.find(
    (r) => typeof r.detail_page === "string" && nfc(r.detail_page).includes(`id=${nId}`),
  );
  if (byPage) return byPage;
  // Tolerante a acentos/mayúsculas.
  const fId = fold(id);
  const folded = rooms.find((r) => fold(str(r.id) ?? "") === fId);
  if (folded) return folded;
  return rooms.find((r) => fold(str(r.id) ?? "").includes(fId)) ?? null;
}

export async function extractUrbantechome(
  sourceUrl: string,
): Promise<ImportPreview> {
  const warnings: string[] = [];
  const url = new URL(sourceUrl);
  const id = url.searchParams.get("id");
  if (!id) {
    throw new Error("El enlace de UrbantecHome no lleva ?id= de vivienda");
  }

  const res = await fetch(API_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`urbantechome_api_${res.status}`);
  const data = (await res.json()) as unknown;
  const rooms = Array.isArray(data) ? (data as Room[]) : [];
  const room = findRoom(rooms, id);
  if (!room) throw new Error(`No se encontró la vivienda "${id}" en UrbantecHome`);

  const title = str(room.title) ?? str(room.viviendaNombre) ?? "Vivienda";
  const rawDesc =
    str(room.description) ?? str(room.description_short) ?? "";
  const description = rawDesc ? sanitize(stripTags(rawDesc)) || null : null;

  const price = num(room.precio) ?? num(room.price);
  const bedrooms = num(room.numero_dormitorios) ?? num(room.bedrooms);
  const bathrooms = num(room.numero_banos) ?? num(room.bathroom_type);
  const squareMeters = num(room.tamano_m2) ?? num(room.superficie);
  const address =
    str(room.direccion) ??
    ([str(room.calle), str(room.numero_via)].filter(Boolean).join(" ") ||
      title);

  const photos = extractPhotos(room);

  if (price === null) warnings.push("precio no detectado — revísalo");
  if (photos.length === 0) warnings.push("sin fotos — verifica el enlace");
  warnings.push("asigna la zona/subzona antes de publicar");

  return {
    portal: "urbantechome",
    sourceUrl,
    externalReference: str(room.id) ?? str(room.codigo_piso) ?? id,
    title,
    description,
    // UrbantecHome es plataforma de alquiler (vivienda completa o habitaciones).
    operation: "rent",
    stay: null,
    price,
    currency: price !== null ? "EUR" : null,
    bedrooms,
    bathrooms,
    squareMeters,
    zone: null,
    address: address || null,
    features: extractFeatures(room),
    latitude: num(room.lat),
    longitude: num(room.lng),
    photos,
    rawAttributes: {
      tipo_vivienda: str(room.tipo_vivienda),
      codigo_piso: str(room.codigo_piso),
      ciudad: str(room.ciudad),
      cp: str(room.codigo_postal) ?? str(room.cp),
    },
    warnings,
  };
}
