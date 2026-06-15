import "server-only";
import { createAdminClient } from "@/lib/db/admin";

// Geocoding ligero contra OpenStreetMap (Nominatim). Gratis, sin API key.
// Usage policy: User-Agent identificable + máximo ~1 req/s. Cacheamos en
// BD para no llamar varias veces a la misma propiedad.
//
// https://operations.osmfoundation.org/policies/nominatim/

const USER_AGENT = "smartbc-portal/1.0 (contacto@bcousinoprop.com)";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export type GeoCoords = { lat: number; lng: number };

async function nominatimSearch(query: string): Promise<GeoCoords | null> {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=es`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    const hit = data[0];
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

// Construye la query de geocoding lo más precisa posible. Si tenemos
// `address` (ej. "Calle Velázquez"), incluimos calle + zona + Madrid.
// Si no, solo zona + Madrid. Si geocoding falla, devolvemos null y
// el caller cae a las coordenadas hardcoded de barrio.
export async function geocodePropertyAddress(params: {
  address: string | null;
  zone: string;
}): Promise<GeoCoords | null> {
  const parts: string[] = [];
  if (params.address) parts.push(params.address);
  if (params.zone) parts.push(params.zone);
  parts.push("Madrid", "España");
  return nominatimSearch(parts.join(", "));
}

// Devuelve coords cacheadas si existen; si no, geocodifica y guarda.
// La escritura en BD usa service role (bypasa RLS). Si todo falla,
// devuelve null y el SmartLink usará el fallback por barrio.
export async function getOrComputePropertyCoords(params: {
  propertyId: string;
  address: string | null;
  zone: string;
  cachedLat: number | null;
  cachedLng: number | null;
}): Promise<GeoCoords | null> {
  if (params.cachedLat != null && params.cachedLng != null) {
    return { lat: params.cachedLat, lng: params.cachedLng };
  }

  const coords = await geocodePropertyAddress({
    address: params.address,
    zone: params.zone,
  });
  if (!coords) return null;

  // Cachear en BD (best-effort, no bloquea si falla).
  const supabase = createAdminClient();
  const propsTbl = supabase.from("properties") as unknown as {
    update: (payload: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{
        error: { message: string } | null;
      }>;
    };
  };
  await propsTbl
    .update({
      latitude: coords.lat,
      longitude: coords.lng,
      geocoded_at: new Date().toISOString(),
    })
    .eq("id", params.propertyId);

  return coords;
}
