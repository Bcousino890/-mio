"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/db/auth-helpers";
import { createClient } from "@/lib/db/server";
import { createAdminClient } from "@/lib/db/admin";
import { shareSlug } from "@/lib/share-slug";
import type { Operation, StayType } from "@/lib/types";

export type CreatePropertyInput = {
  title: string;
  slug?: string;
  agencySlug: string;
  operation: Operation;
  stayType?: StayType;
  price: number;
  bedrooms: number;
  bathrooms: number;
  squareMeters?: number;
  zone: string;
  address?: string;
  description?: string;
  externalReference?: string;
};

export type CreatePropertyResult =
  | { ok: true; slug: string; id: string }
  | { ok: false; error: string };

function normalizeSlug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createProperty(
  input: CreatePropertyInput,
): Promise<CreatePropertyResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  const title = input.title.trim();
  if (!title) return { ok: false, error: "title_required" };

  // Slug: si no llega lo derivamos del título; añadimos un sufijo corto para
  // evitar colisiones cuando varias propiedades comparten título.
  const baseSlug = normalizeSlug(input.slug?.trim() || title);
  if (!baseSlug) return { ok: false, error: "slug_required" };
  const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

  // Resolver agencia desde su slug.
  const agencyLookup = await supabase
    .from("agencies")
    .select("id")
    .eq("slug", input.agencySlug)
    .maybeSingle();
  const agencyRow = agencyLookup.data as { id: string } | null;
  if (!agencyRow) return { ok: false, error: "agency_not_found" };

  // supabase-js no infiere bien Insert tras chains tipadas — bypass puntual.
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

  const insertResult = await propsTbl
    .insert({
      title,
      slug,
      agency_id: agencyRow.id,
      source: "manual",
      external_id: input.externalReference?.trim() || null,
      operation: input.operation === "alquiler" ? "rent" : "sale",
      stay: input.stayType
        ? input.stayType === "corta"
          ? "short"
          : "long"
        : null,
      status: "available",
      price: input.price,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      square_meters: input.squareMeters ?? null,
      zone: input.zone.trim(),
      address: input.address?.trim() || null,
      description: input.description?.trim() || null,
    })
    .select("id, slug")
    .maybeSingle();

  if (insertResult.error) {
    return { ok: false, error: insertResult.error.message };
  }
  if (!insertResult.data) return { ok: false, error: "insert_no_row" };

  revalidatePath("/admin/propiedades");
  revalidatePath(`/admin/agencias/${input.agencySlug}`);
  return { ok: true, slug: insertResult.data.slug, id: insertResult.data.id };
}

export type ArchivePropertyInput = { slug: string };

export type ArchivePropertyResult =
  | { ok: true }
  | { ok: false; error: string };

export type UploadPropertyPhotoResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function uploadPropertyPhoto(
  formData: FormData,
): Promise<UploadPropertyPhotoResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  const slug = String(formData.get("slug") ?? "").trim();
  const file = formData.get("file");
  const isCoverRaw = String(formData.get("isCover") ?? "false");
  const isCover = isCoverRaw === "true";

  if (!slug) return { ok: false, error: "slug_required" };
  if (!(file instanceof File)) return { ok: false, error: "file_required" };
  if (file.size === 0) return { ok: false, error: "file_empty" };

  // Buscar la propiedad por slug para tener su id (UUID).
  const propLookup = await supabase
    .from("properties")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  const propRow = propLookup.data as { id: string } | null;
  if (!propRow) return { ok: false, error: "property_not_found" };

  // Path: {property_id}/{timestamp}-{filename}. Mantiene fotos agrupadas por
  // propiedad y evita colisiones cuando el admin sube dos archivos con el
  // mismo nombre original.
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const path = `${propRow.id}/${Date.now()}-${safeName}`;

  const arrayBuffer = await file.arrayBuffer();
  const uploadResult = await supabase.storage
    .from("properties-photos")
    .upload(path, arrayBuffer, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });

  if (uploadResult.error) {
    return { ok: false, error: uploadResult.error.message };
  }

  const { data: urlData } = supabase.storage
    .from("properties-photos")
    .getPublicUrl(path);
  const publicUrl = urlData.publicUrl;

  // Insertar referencia en property_photos. Posición incremental.
  const positionLookup = await supabase
    .from("property_photos")
    .select("position")
    .eq("property_id", propRow.id)
    .order("position", { ascending: false })
    .limit(1);
  const lastPos =
    ((positionLookup.data as Array<{ position: number }> | null)?.[0]
      ?.position ?? -1) + 1;

  const photosTbl = supabase.from("property_photos") as unknown as {
    insert: (
      payload: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>;
  };

  const photoInsert = await photosTbl.insert({
    property_id: propRow.id,
    url: publicUrl,
    position: lastPos,
    is_cover: isCover,
  });
  if (photoInsert.error) {
    return { ok: false, error: photoInsert.error.message };
  }

  // Si es cover, además guardarla en properties.cover_photo_url.
  if (isCover) {
    const propsTbl = supabase.from("properties") as unknown as {
      update: (payload: Record<string, unknown>) => {
        eq: (
          column: string,
          value: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    };
    await propsTbl
      .update({ cover_photo_url: publicUrl })
      .eq("id", propRow.id);
  }

  revalidatePath("/admin/propiedades");
  revalidatePath(`/admin/propiedades/${slug}`);
  return { ok: true, url: publicUrl };
}

export type ReorderPhotosResult = { ok: true } | { ok: false; error: string };

// Reordena las fotos de una propiedad. La PRIMERA del array pasa a ser la
// portada (position 0 + is_cover + properties.cover_photo_url), que es la que
// el SmartLink usa como principal.
export async function reorderPropertyPhotos(
  slug: string,
  orderedUrls: string[],
): Promise<ReorderPhotosResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;
  if (!slug || orderedUrls.length === 0)
    return { ok: false, error: "invalid_input" };

  const propLookup = await supabase
    .from("properties")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  const prop = propLookup.data as { id: string } | null;
  if (!prop) return { ok: false, error: "property_not_found" };

  const photosTbl = supabase.from("property_photos") as unknown as {
    update: (payload: Record<string, unknown>) => {
      eq: (c: string, v: string) => {
        eq: (
          c2: string,
          v2: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
  for (let i = 0; i < orderedUrls.length; i++) {
    const res = await photosTbl
      .update({ position: i, is_cover: i === 0 })
      .eq("property_id", prop.id)
      .eq("url", orderedUrls[i]);
    if (res.error) return { ok: false, error: res.error.message };
  }

  const propsTbl = supabase.from("properties") as unknown as {
    update: (payload: Record<string, unknown>) => {
      eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
    };
  };
  await propsTbl.update({ cover_photo_url: orderedUrls[0] }).eq("id", prop.id);

  revalidatePath("/admin/propiedades");
  revalidatePath(`/admin/propiedades/${slug}`);
  return { ok: true };
}

export type DeletePropertyPhotoInput = {
  slug: string;
  photoUrl: string;
};

export type DeletePropertyPhotoResult =
  | { ok: true }
  | { ok: false; error: string };

export async function deletePropertyPhoto(
  input: DeletePropertyPhotoInput,
): Promise<DeletePropertyPhotoResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  const propLookup = await supabase
    .from("properties")
    .select("id, cover_photo_url")
    .eq("slug", input.slug)
    .maybeSingle();
  const propRow = propLookup.data as
    | { id: string; cover_photo_url: string | null }
    | null;
  if (!propRow) return { ok: false, error: "property_not_found" };

  // Storage path = todo después de '/storage/v1/object/public/properties-photos/'.
  const marker = "/properties-photos/";
  const idx = input.photoUrl.indexOf(marker);
  if (idx === -1) return { ok: false, error: "bad_photo_url" };
  const path = input.photoUrl.slice(idx + marker.length);

  await supabase.storage.from("properties-photos").remove([path]);

  const photosTbl = supabase.from("property_photos") as unknown as {
    delete: () => {
      eq: (
        column: string,
        value: string,
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
  const delResult = await photosTbl.delete().eq("url", input.photoUrl);
  if (delResult.error) {
    return { ok: false, error: delResult.error.message };
  }

  // Si la foto borrada era la cover, limpiar el campo en properties.
  if (propRow.cover_photo_url === input.photoUrl) {
    const propsTbl = supabase.from("properties") as unknown as {
      update: (payload: Record<string, unknown>) => {
        eq: (
          column: string,
          value: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    };
    await propsTbl.update({ cover_photo_url: null }).eq("id", propRow.id);
  }

  revalidatePath("/admin/propiedades");
  return { ok: true };
}

export type UpdatePropertyInput = {
  slug: string;
  // Campos sindicados: si la propiedad viene de una agencia (source='scrape')
  // estos se sobrescriben en el siguiente sync. Para manuales son definitivos.
  // `null` (donde aplica) significa "limpiar el campo".
  title?: string;
  description?: string | null;
  price?: number;
  operation?: "rent" | "sale";
  stay?: "short" | "long" | null;
  availableFrom?: string | null;
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number | null;
  zone?: string;
  address?: string | null;
  status?: "available" | "reserved" | "sold" | "archived";
  features?: string[];
  // Features añadidas a mano por BC. Se preservan en sync (no se sobreescriben).
  // En la vista pública se unen con `features` deduplicando.
  featuresManual?: string[];
  // Campos internos del admin: el motor de sync NO los toca nunca.
  ownerName?: string | null;
  ownerPhone?: string | null;
  ownerEmail?: string | null;
  internalNotes?: string | null;
};

export type UpdatePropertyResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateProperty(
  input: UpdatePropertyInput,
): Promise<UpdatePropertyResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  if (!input.slug) return { ok: false, error: "slug_required" };

  // Solo incluimos los campos que el admin envía (undefined = no tocar).
  // Permitimos null explícito para limpiar un campo opcional.
  const payload: Record<string, unknown> = {};
  if (input.title !== undefined) payload.title = input.title.trim();
  if (input.description !== undefined)
    payload.description = input.description?.trim() || null;
  if (input.operation !== undefined) payload.operation = input.operation;
  if (input.stay !== undefined) payload.stay = input.stay;
  if (input.availableFrom !== undefined)
    payload.available_from = input.availableFrom || null;
  if (input.price !== undefined) payload.price = input.price;
  if (input.bedrooms !== undefined) payload.bedrooms = input.bedrooms;
  if (input.bathrooms !== undefined) payload.bathrooms = input.bathrooms;
  if (input.squareMeters !== undefined)
    payload.square_meters = input.squareMeters;
  if (input.zone !== undefined) {
    payload.zone = input.zone.trim();
    // Si cambia la zona, invalidamos las coords cacheadas para que el
    // próximo SmartLink vuelva a geocodificar con la zona nueva.
    payload.latitude = null;
    payload.longitude = null;
    payload.geocoded_at = null;
  }
  if (input.address !== undefined) {
    payload.address = input.address?.trim() || null;
    // Misma lógica: si cambia la dirección, re-geocodificar al próximo
    // acceso al SmartLink.
    payload.latitude = null;
    payload.longitude = null;
    payload.geocoded_at = null;
  }
  if (input.status !== undefined) {
    payload.status = input.status;
    // Si pasa a archived, también ponemos archived_at; si se reactiva, lo limpiamos.
    if (input.status === "archived") {
      payload.archived_at = new Date().toISOString();
    } else {
      payload.archived_at = null;
    }
  }
  if (input.features !== undefined) payload.features = input.features;
  if (input.featuresManual !== undefined) {
    // Normalizamos: trim, descartamos vacíos, deduplicamos.
    const cleaned = Array.from(
      new Set(
        input.featuresManual
          .map((f) => f.trim())
          .filter((f): f is string => f.length > 0),
      ),
    );
    payload.features_manual = cleaned;
  }
  if (input.ownerName !== undefined)
    payload.owner_name = input.ownerName?.trim() || null;
  if (input.ownerPhone !== undefined)
    payload.owner_phone = input.ownerPhone?.trim() || null;
  if (input.ownerEmail !== undefined)
    payload.owner_email = input.ownerEmail?.trim() || null;
  if (input.internalNotes !== undefined)
    payload.internal_notes = input.internalNotes?.trim() || null;

  if (Object.keys(payload).length === 0) {
    return { ok: false, error: "nothing_to_update" };
  }

  // Usamos el admin client (service role) tras validar staff: con el cliente
  // de sesión, una política RLS que no reconozca el rol hace que el UPDATE
  // afecte 0 filas SIN error → el admin cree que guardó pero el SmartLink
  // sigue mostrando datos viejos. Con .select() confirmamos que la fila
  // realmente se actualizó.
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error: updateErr } = await (admin as any)
    .from("properties")
    .update(payload)
    .eq("slug", input.slug)
    .select("id, slug, bc_reference");
  if (updateErr) return { ok: false, error: updateErr.message };
  if (!updated || updated.length === 0) {
    return { ok: false, error: "property_not_found" };
  }

  revalidatePath("/admin/propiedades");
  revalidatePath(`/admin/propiedades/${input.slug}`);
  // Rutas públicas: el SmartLink se comparte tanto con el slug plano como
  // con la referencia BC delante (bc0871-…). Revalidamos ambas para que
  // los cambios se vean al instante en "Ver como cliente" / SmartLink.
  revalidatePath(`/compartir/${input.slug}`);
  const bcRef = (updated[0] as { bc_reference: string | null }).bc_reference;
  if (bcRef) {
    revalidatePath(`/compartir/${shareSlug(input.slug, bcRef)}`);
  }
  revalidatePath(`/og/property/${input.slug}`);
  return { ok: true };
}

// ============================================================
// SmartLinks (tokens únicos por envío + tracking de aperturas)
// ============================================================

export type ShareSummary = {
  id: string;
  token: string;
  label: string | null;
  expires_at: string | null;
  created_at: string;
  opens_count: number;
  last_opened_at: string | null;
};

function randomToken(len = 28): string {
  // Token URL-safe (base64url sin padding). 28 chars ≈ 168 bits, suficiente.
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Buffer.from(arr)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, len);
}

export type CreateShareResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

export async function createShareLink(
  slug: string,
  label: string | null,
): Promise<CreateShareResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  // Resolver property_id desde el slug.
  const propRes = await supabase
    .from("properties")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  const prop = propRes.data as { id: string } | null;
  if (!prop) return { ok: false, error: "property_not_found" };

  const token = randomToken();
  const sharesTbl = supabase.from("property_shares") as unknown as {
    insert: (payload: Record<string, unknown>) => Promise<{
      error: { message: string } | null;
    }>;
  };
  const res = await sharesTbl.insert({
    property_id: prop.id,
    token,
    label: label?.trim() || null,
    created_by: auth.userId,
  });
  if (res.error) return { ok: false, error: res.error.message };

  revalidatePath(`/admin/propiedades/${slug}`);
  return { ok: true, token };
}

export type DeleteShareResult = { ok: true } | { ok: false; error: string };

export async function deleteShareLink(
  shareId: string,
  slug: string,
): Promise<DeleteShareResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  const sharesTbl = supabase.from("property_shares") as unknown as {
    delete: () => {
      eq: (col: string, val: string) => Promise<{
        error: { message: string } | null;
      }>;
    };
  };
  const res = await sharesTbl.delete().eq("id", shareId);
  if (res.error) return { ok: false, error: res.error.message };

  revalidatePath(`/admin/propiedades/${slug}`);
  return { ok: true };
}

export async function archiveProperty(
  input: ArchivePropertyInput,
): Promise<ArchivePropertyResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  const propsTbl = supabase.from("properties") as unknown as {
    update: (payload: Record<string, unknown>) => {
      eq: (
        column: string,
        value: string,
      ) => Promise<{ error: { message: string } | null }>;
    };
  };

  const writeResult = await propsTbl
    .update({ archived_at: new Date().toISOString(), status: "archived" })
    .eq("slug", input.slug);

  if (writeResult.error) {
    return { ok: false, error: writeResult.error.message };
  }

  revalidatePath("/admin/propiedades");
  return { ok: true };
}

// ─── Videos y Planos (property_media) ─────────────────────────────────────

export type MediaItem = {
  id: string;
  url: string;
  file_name: string;
  type: "video" | "plan";
  storage_path: string;
};

export type AddVideoResult = { ok: true; item: MediaItem } | { ok: false; error: string };
export type UploadVideoResult = { ok: true; item: MediaItem } | { ok: false; error: string };
export type DeleteMediaResult = { ok: true } | { ok: false; error: string };
export type UploadPlanResult = { ok: true; item: MediaItem } | { ok: false; error: string };

export async function addPropertyVideo(
  slug: string,
  videoUrl: string,
): Promise<AddVideoResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  if (!slug) return { ok: false, error: "slug_required" };
  if (!videoUrl?.trim()) return { ok: false, error: "url_required" };

  let parsedUrl: URL;
  try { parsedUrl = new URL(videoUrl.trim()); } catch {
    return { ok: false, error: "URL inválida — usa un enlace de YouTube o Vimeo" };
  }

  const propLookup = await supabase
    .from("properties")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  const prop = propLookup.data as { id: string } | null;
  if (!prop) return { ok: false, error: "property_not_found" };

  const admin = createAdminClient();
  const { data, error } = await (admin as any)
    .from("property_media")
    .insert({
      property_id: prop.id,
      type: "video",
      file_name: parsedUrl.hostname,
      storage_path: parsedUrl.toString(),
      url: parsedUrl.toString(),
    })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/propiedades/${slug}`);
  return {
    ok: true,
    item: { id: data.id, url: data.url, file_name: data.file_name, type: "video", storage_path: data.storage_path },
  };
}

export async function uploadPropertyVideo(
  formData: FormData,
): Promise<UploadVideoResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  const slug = String(formData.get("slug") ?? "").trim();
  const file = formData.get("file");

  if (!slug) return { ok: false, error: "slug_required" };
  if (!(file instanceof File)) return { ok: false, error: "file_required" };
  if (file.size === 0) return { ok: false, error: "file_empty" };
  if (file.size > 500 * 1024 * 1024) return { ok: false, error: "Archivo muy grande (máx 500MB)" };

  const allowedTypes = ["video/mp4", "video/quicktime", "video/webm"];
  if (file.type && !allowedTypes.includes(file.type)) {
    return { ok: false, error: "Formato no soportado. Usa MP4, MOV o WebM." };
  }

  const propLookup = await supabase
    .from("properties")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  const prop = propLookup.data as { id: string } | null;
  if (!prop) return { ok: false, error: "property_not_found" };

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const storagePath = `${prop.id}/video/${Date.now()}-${safeName}`;

  // Upload directo del archivo (streaming, sin cargar en memoria).
  // El cliente de Supabase maneja archivos grandes de forma eficiente.
  const admin = createAdminClient();
  const { error: uploadErr } = await (admin as any).storage
    .from("properties-photos")
    .upload(storagePath, file, { contentType: file.type || "video/mp4", upsert: false });

  if (uploadErr) {
    console.error("[uploadPropertyVideo] storage error:", uploadErr);
    const msg = uploadErr.message ?? "";
    if (/too large|size|exceeds/i.test(msg)) {
      return { ok: false, error: "Vídeo demasiado grande. Reduce el tamaño, comprime el MP4, o súbelo a YouTube/Vimeo y pega el enlace." };
    }
    return { ok: false, error: uploadErr.message || "Error al subir vídeo" };
  }

  const { data: urlData } = (admin as any).storage
    .from("properties-photos")
    .getPublicUrl(storagePath);
  const publicUrl = urlData.publicUrl;

  const { data, error } = await (admin as any)
    .from("property_media")
    .insert({
      property_id: prop.id,
      type: "video",
      file_name: file.name,
      storage_path: storagePath,
      url: publicUrl,
    })
    .select()
    .single();

  if (error) {
    console.error("[uploadPropertyVideo] insert error:", error);
    return { ok: false, error: error.message };
  }

  revalidatePath(`/admin/propiedades/${slug}`);
  return {
    ok: true,
    item: { id: data.id, url: data.url, file_name: data.file_name, type: "video", storage_path: data.storage_path },
  };
}

export async function uploadPropertyPlan(
  formData: FormData,
): Promise<UploadPlanResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  const slug = String(formData.get("slug") ?? "").trim();
  const file = formData.get("file");

  if (!slug) return { ok: false, error: "slug_required" };
  if (!(file instanceof File)) return { ok: false, error: "file_required" };
  if (file.size === 0) return { ok: false, error: "file_empty" };
  if (file.size > 100 * 1024 * 1024) return { ok: false, error: "Archivo muy grande (máx 100MB)" };

  const propLookup = await supabase
    .from("properties")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  const prop = propLookup.data as { id: string } | null;
  if (!prop) return { ok: false, error: "property_not_found" };

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const storagePath = `${prop.id}/plan/${Date.now()}-${safeName}`;

  // Upload directo del archivo (streaming, sin cargar en memoria).
  const admin = createAdminClient();
  const { error: uploadErr } = await (admin as any).storage
    .from("properties-photos")
    .upload(storagePath, file, { contentType: file.type || "image/jpeg", upsert: false });

  if (uploadErr) {
    console.error("[uploadPropertyPlan] storage error:", uploadErr);
    return { ok: false, error: uploadErr.message };
  }

  const { data: urlData } = (admin as any).storage
    .from("properties-photos")
    .getPublicUrl(storagePath);
  const publicUrl = urlData.publicUrl;

  const { data, error } = await (admin as any)
    .from("property_media")
    .insert({
      property_id: prop.id,
      type: "plan",
      file_name: file.name,
      storage_path: storagePath,
      url: publicUrl,
    })
    .select()
    .single();

  if (error) {
    console.error("[uploadPropertyPlan] insert error:", error);
    return { ok: false, error: error.message };
  }

  revalidatePath(`/admin/propiedades/${slug}`);
  return {
    ok: true,
    item: { id: data.id, url: data.url, file_name: data.file_name, type: "plan", storage_path: data.storage_path },
  };
}

export async function deletePropertyMedia(
  slug: string,
  mediaId: string,
  storagePath: string,
): Promise<DeleteMediaResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  // Si storagePath es una URL externa (youtube/vimeo), no borrar del storage
  const isExternalUrl = storagePath.startsWith("http");
  if (!isExternalUrl) {
    await (supabase as any).storage.from("properties-photos").remove([storagePath]);
  }

  const { error } = await (supabase as any)
    .from("property_media")
    .delete()
    .eq("id", mediaId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/propiedades/${slug}`);
  return { ok: true };
}
