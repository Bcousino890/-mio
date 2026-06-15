"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/db/auth-helpers";
import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
import { getCurrentProfile } from "@/lib/db/queries/session";
import { normalizeSpanishPhone } from "@/lib/sync/particulares/idealista-advertiser-detector";

export type UpdatePhoneResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateParticularPhone(
  particularId: string,
  phone: string | null,
): Promise<UpdatePhoneResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  if (!particularId) return { ok: false, error: "id_required" };

  // Normalizar SIEMPRE al formato canónico +34XXXXXXXXX. Si el asesor
  // escribió algo que no es un teléfono español válido, rechazamos en vez
  // de guardar basura. Vacío/null = borrar el teléfono (permitido).
  const trimmed = phone?.trim() ?? "";
  let normalized: string | null = null;
  if (trimmed.length > 0) {
    normalized = normalizeSpanishPhone(trimmed);
    if (!normalized) return { ok: false, error: "invalid_phone" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("particulares")
    .update({ phone: normalized, updated_at: new Date().toISOString() })
    .eq("id", particularId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/particulares");
  return { ok: true };
}

export type CreateFromParticularResult =
  | { ok: true; slug: string; alreadyExisted: boolean }
  | { ok: false; error: string };

function normalizeSlug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Convierte un anuncio de particular en una propiedad propia, dentro de la
// agencia "Portales externos" (source=manual). Copia datos, fotos y el contacto
// del propietario (para poder llamarle). Idempotente: si ya se convirtió antes,
// devuelve la propiedad existente en vez de duplicar.
export async function createPropertyFromParticular(
  particularId: string,
): Promise<CreateFromParticularResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;
  if (!particularId) return { ok: false, error: "id_required" };

  // 1) Datos del particular.
  const partRes = await supabase
    .from("particulares")
    .select(
      "id, external_id, source_url, zone, price, operation, bedrooms, bathrooms, square_meters, description, photos, owner_name, phone, latitude, longitude",
    )
    .eq("id", particularId)
    .maybeSingle();
  const part = partRes.data as {
    id: string;
    external_id: string | null;
    source_url: string | null;
    zone: string | null;
    price: number | null;
    operation: "rent" | "sale" | null;
    bedrooms: number | null;
    bathrooms: number | null;
    square_meters: number | null;
    description: string | null;
    photos: Array<{ url: string; alt?: string }> | null;
    owner_name: string | null;
    phone: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  if (!part) return { ok: false, error: "particular_not_found" };

  // 2) Agencia "Portales externos".
  const agencyRes = await supabase
    .from("agencies")
    .select("id")
    .eq("slug", "portales-externos")
    .maybeSingle();
  const agency = agencyRes.data as { id: string } | null;
  if (!agency) return { ok: false, error: "agency_not_found" };

  // external_id estable para idempotencia: si ya existe la propiedad de este
  // particular, devolvemos la suya (evita el duplicate-key y dobles clics).
  const externalId = `particular-${part.id}`;
  const existing = await supabase
    .from("properties")
    .select("slug")
    .eq("agency_id", agency.id)
    .eq("external_id", externalId)
    .maybeSingle();
  const existingRow = existing.data as unknown as { slug: string } | null;
  if (existingRow?.slug) {
    return { ok: true, slug: existingRow.slug, alreadyExisted: true };
  }

  const operation = part.operation === "rent" ? "rent" : "sale";
  const opLabel = operation === "rent" ? "Alquiler" : "Venta";
  const title = `${opLabel} de piso${part.zone ? ` en ${part.zone}` : ""}`;
  const slug = `${normalizeSlug(title) || "propiedad"}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;

  const cover = part.photos?.[0]?.url ?? null;
  const notes = [
    "Captado de un anuncio de particular.",
    part.source_url ? `Anuncio: ${part.source_url}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  // 3) Crear la propiedad.
  const propsTbl = supabase.from("properties") as unknown as {
    insert: (payload: Record<string, unknown>) => {
      select: (cols: string) => {
        maybeSingle: () => Promise<{
          data: { id: string; slug: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  const ins = await propsTbl
    .insert({
      title,
      slug,
      agency_id: agency.id,
      source: "manual",
      external_id: externalId,
      operation,
      status: "available",
      price: part.price ?? 0,
      bedrooms: part.bedrooms ?? 0,
      bathrooms: part.bathrooms ?? 0,
      square_meters: part.square_meters,
      zone: part.zone ?? "Madrid",
      description: part.description,
      owner_name: part.owner_name,
      owner_phone: part.phone,
      internal_notes: notes,
      latitude: part.latitude,
      longitude: part.longitude,
      cover_photo_url: cover,
    })
    .select("id, slug")
    .maybeSingle();
  if (ins.error) return { ok: false, error: ins.error.message };
  if (!ins.data) return { ok: false, error: "insert_no_row" };

  // 4) Copiar las fotos (referenciando las URLs del anuncio; uso interno).
  const photos = part.photos ?? [];
  if (photos.length > 0) {
    const photosTbl = supabase.from("property_photos") as unknown as {
      insert: (
        payload: Array<Record<string, unknown>>,
      ) => Promise<{ error: { message: string } | null }>;
    };
    await photosTbl.insert(
      photos.map((ph, i) => ({
        property_id: ins.data!.id,
        url: ph.url,
        alt: ph.alt ?? null,
        position: i,
        is_cover: i === 0,
      })),
    );
  }

  // 5) Copiar plano y vídeo del anuncio (si los tiene) a property_media para
  // que aparezcan en el SmartLink. Select aparte y best-effort: las columnas
  // son de la migración 0036 y pueden no estar aplicadas aún en el VPS.
  const mediaRes = await supabase
    .from("particulares")
    .select("floor_plan_url, video_url")
    .eq("id", particularId)
    .maybeSingle();
  const partMedia = mediaRes.data as unknown as {
    floor_plan_url: string | null;
    video_url: string | null;
  } | null;
  if (!mediaRes.error && partMedia) {
    const mediaRows: Array<Record<string, unknown>> = [];
    if (partMedia.video_url) {
      mediaRows.push({
        property_id: ins.data.id,
        type: "video",
        file_name: "video-anuncio.mp4",
        storage_path: `external/particular/${part.id}/video`,
        url: partMedia.video_url,
      });
    }
    if (partMedia.floor_plan_url) {
      mediaRows.push({
        property_id: ins.data.id,
        type: "plan",
        file_name: "plano-anuncio.jpg",
        storage_path: `external/particular/${part.id}/plan`,
        url: partMedia.floor_plan_url,
      });
    }
    if (mediaRows.length > 0) {
      const adminClient = createAdminClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (adminClient as any).from("property_media").insert(mediaRows);
    }
  }

  revalidatePath("/admin/propiedades");
  revalidatePath("/admin/agencias/portales-externos");
  return { ok: true, slug: ins.data.slug, alreadyExisted: false };
}

export type LogContactResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function logParticularContact(
  particularId: string,
  contactType: "call" | "whatsapp" | "email" | "visit" | "note",
  outcome: string | null,
  notes: string | null,
): Promise<LogContactResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "no_profile" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("particulares_contacts")
    .insert({
      particular_id: particularId,
      advisor_id: profile.id,
      contact_type: contactType,
      outcome: outcome || null,
      notes: notes || null,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/particulares");
  return { ok: true, id: data.id };
}

export type AssignParticularResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Asigna (o desasigna con null) un particular a un asesor. Evita que dos
 * personas trabajen el mismo anuncio sin saberlo.
 */
export async function assignParticular(
  particularId: string,
  advisorId: string | null,
): Promise<AssignParticularResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("particulares")
    .update({
      assigned_to: advisorId,
      assigned_at: advisorId ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", particularId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/particulares");
  return { ok: true };
}

export type SetActiveResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Retira (o reactiva) un anuncio manualmente. Hasta ahora las bajas solo
 * las detectaba el cron (404 en el portal); con esto un asesor puede
 * archivar un anuncio ya gestionado para que aparezca en el tab "Retirados"
 * sin esperar a que Idealista lo elimine. Conserva todos los datos.
 */
export async function setParticularActive(
  particularId: string,
  active: boolean,
): Promise<SetActiveResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;
  if (!particularId) return { ok: false, error: "id_required" };

  const now = new Date().toISOString();
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("particulares")
    .update({
      is_active: active,
      taken_down_at: active ? null : now,
      updated_at: now,
    })
    .eq("id", particularId);
  if (error) return { ok: false, error: error.message };

  // Historial: mismo formato que las bajas/reactivaciones del cron.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("particulares_changes").insert({
    particular_id: particularId,
    change_type: active ? "reactivated" : "deleted",
    old_value: null,
    new_value: active ? { reactivated_at: now } : { taken_down_at: now },
    changed_at: now,
  });

  revalidatePath("/admin/particulares");
  return { ok: true };
}

export type BulkActionResult =
  | { ok: true; updated: number }
  | { ok: false; error: string };

export async function markParticularAsVerified(
  particularIds: string[],
): Promise<BulkActionResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  if (!particularIds || particularIds.length === 0) {
    return { ok: false, error: "no_ids" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error, data } = await (supabase as any)
    .from("particulares")
    .update({
      // Columnas reales según 0023_particulares_phone_fields.sql
      phone_manually_verified: true,
      phone_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in("id", particularIds)
    .select("id");

  if (error) return { ok: false, error: error.message };

  const updated = (data as { id: string }[])?.length ?? 0;
  revalidatePath("/admin/particulares");
  return { ok: true, updated };
}

export async function rescrapeParticularPhones(
  particularIds: string[],
): Promise<BulkActionResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  if (!particularIds || particularIds.length === 0) {
    return { ok: false, error: "no_ids" };
  }

  // Mark as needing re-scrape by resetting phone and verification fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error, data } = await (supabase as any)
    .from("particulares")
    .update({
      phone: null,
      phone_manually_verified: false,
      phone_verified_at: null,
      updated_at: new Date().toISOString(),
    })
    .in("id", particularIds)
    .select("id");

  if (error) return { ok: false, error: error.message };

  const updated = (data as { id: string }[])?.length ?? 0;
  revalidatePath("/admin/particulares");
  return { ok: true, updated };
}
