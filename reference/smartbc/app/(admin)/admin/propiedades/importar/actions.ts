"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/db/auth-helpers";
import { createClient } from "@/lib/db/server";
import { extractFromUrl } from "@/lib/sync/import-by-link";
import { insertImportedProperty } from "@/lib/sync/import-by-link/insert";
import type {
  ImportExtractError,
  ImportPreview,
} from "@/lib/sync/import-by-link/types";

export type PreviewByLinkResult =
  | { ok: true; preview: ImportPreview }
  | { ok: false; error: string; kind: ImportExtractError["kind"] | "auth" };

export async function previewByLink(
  url: string,
): Promise<PreviewByLinkResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return { ok: false, error: auth.error, kind: "auth" };

  const trimmed = url.trim();
  if (!trimmed) {
    return {
      ok: false,
      kind: "unsupported_url",
      error: "URL vacío",
    };
  }
  // Límite de seguridad: solo http/https. La validación profunda la hace
  // `detectPortal` dentro de `extractFromUrl`.
  if (!/^https?:\/\//i.test(trimmed)) {
    return {
      ok: false,
      kind: "unsupported_url",
      error: "Solo se admiten URLs http:// o https://",
    };
  }

  const result = await extractFromUrl(trimmed);
  if (!result.ok) {
    const reasonMap: Record<ImportExtractError["kind"], string> = {
      fetch_failed: "no se pudo descargar la página",
      blocked: "el portal bloqueó la petición (anti-bot)",
      unsupported_url: "URL no soportada",
      parse_failed: "no se pudo procesar el HTML",
    };
    const base = reasonMap[result.error.kind];
    const detail =
      "reason" in result.error ? ` — ${result.error.reason}` : "";
    return { ok: false, kind: result.error.kind, error: `${base}${detail}` };
  }
  return { ok: true, preview: result.preview };
}

export type ConfirmByLinkInput = {
  preview: ImportPreview;
  agencySlug: string;
  overrides: {
    title: string;
    description: string | null;
    operation: "rent" | "sale";
    stay: "long" | "short" | null;
    price: number;
    bedrooms: number;
    bathrooms: number;
    squareMeters: number | null;
    zone: string;
    address: string | null;
    features: string[];
    externalReference: string;
    // Subconjunto de fotos seleccionadas por el admin (índices del array
    // original de la preview). Si viene vacío, se usan todas.
    photoIndexes?: number[];
  };
};

export type ConfirmByLinkResult =
  | { ok: true; slug: string; photosProcessed: number }
  | { ok: false; error: string };

export async function confirmByLink(
  input: ConfirmByLinkInput,
): Promise<ConfirmByLinkResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return { ok: false, error: auth.error };

  const { preview, agencySlug, overrides } = input;

  // Validaciones mínimas — la UI ya filtra, esto es defensa en profundidad.
  if (!overrides.title.trim()) return { ok: false, error: "title_required" };
  if (!overrides.zone.trim()) return { ok: false, error: "zone_required" };
  if (!overrides.price || overrides.price <= 0)
    return { ok: false, error: "price_required" };
  if (!overrides.externalReference.trim())
    return { ok: false, error: "external_reference_required" };

  // Resolver agency_id por slug.
  const agencyRes = await supabase
    .from("agencies")
    .select("id")
    .eq("slug", agencySlug)
    .maybeSingle();
  const agency = agencyRes.data as { id: string } | null;
  if (!agency) return { ok: false, error: "agency_not_found" };

  // Aplicar selección de fotos.
  const filteredPhotos =
    overrides.photoIndexes && overrides.photoIndexes.length > 0
      ? overrides.photoIndexes
          .filter((i) => i >= 0 && i < preview.photos.length)
          .map((i) => preview.photos[i])
      : preview.photos;

  const result = await insertImportedProperty({
    preview: { ...preview, photos: filteredPhotos },
    agencyId: agency.id,
    agencySlug,
    overrides: {
      title: overrides.title.trim(),
      description: overrides.description?.trim() || null,
      operation: overrides.operation,
      stay: overrides.stay,
      price: overrides.price,
      bedrooms: overrides.bedrooms,
      bathrooms: overrides.bathrooms,
      squareMeters: overrides.squareMeters,
      zone: overrides.zone.trim(),
      address: overrides.address?.trim() || null,
      features: overrides.features,
      externalReference: overrides.externalReference.trim(),
    },
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/admin/propiedades");
  return {
    ok: true,
    slug: result.slug,
    photosProcessed: result.photosProcessed,
  };
}
