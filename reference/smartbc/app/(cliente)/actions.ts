"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/db/auth-helpers";
import { createClient } from "@/lib/db/server";

export type ToggleFavoriteInput = { slug: string };
export type ToggleFavoriteResult =
  | { ok: true; isFavorite: boolean }
  | { ok: false; error: string };

export async function toggleFavorite(
  input: ToggleFavoriteInput,
): Promise<ToggleFavoriteResult> {
  const supabase = await createClient();
  const auth = await requireSession(supabase);
  if (!auth.ok) return auth;
  const userId = auth.userId;

  // Buscar la propiedad por slug.
  const propLookup = await supabase
    .from("properties")
    .select("id")
    .eq("slug", input.slug)
    .maybeSingle();
  const propRow = propLookup.data as { id: string } | null;
  if (!propRow) return { ok: false, error: "property_not_found" };

  // Comprobar si ya es favorito.
  const existingLookup = await supabase
    .from("favorites")
    .select("client_id")
    .eq("client_id", userId)
    .eq("property_id", propRow.id)
    .maybeSingle();

  const favTbl = supabase.from("favorites") as unknown as {
    insert: (
      payload: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>;
    delete: () => {
      eq: (column: string, value: string) => {
        eq: (
          column: string,
          value: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    };
  };

  if (existingLookup.data) {
    const delResult = await favTbl
      .delete()
      .eq("client_id", userId)
      .eq("property_id", propRow.id);
    if (delResult.error) return { ok: false, error: delResult.error.message };
    revalidatePath("/favoritos");
    revalidatePath("/propiedades");
    return { ok: true, isFavorite: false };
  }

  const insResult = await favTbl.insert({
    client_id: userId,
    property_id: propRow.id,
  });
  if (insResult.error) return { ok: false, error: insResult.error.message };
  revalidatePath("/favoritos");
  revalidatePath("/propiedades");
  return { ok: true, isFavorite: true };
}

export type UpdateProfileInput = {
  firstName: string;
  lastName: string;
  phone?: string;
};

export type UpdateProfileResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateClientProfile(
  input: UpdateProfileInput,
): Promise<UpdateProfileResult> {
  const supabase = await createClient();
  const auth = await requireSession(supabase);
  if (!auth.ok) return auth;
  const userId = auth.userId;

  const fullName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
  if (!fullName) return { ok: false, error: "name_required" };

  const profTbl = supabase.from("profiles") as unknown as {
    update: (payload: Record<string, unknown>) => {
      eq: (
        column: string,
        value: string,
      ) => Promise<{ error: { message: string } | null }>;
    };
  };

  const result = await profTbl
    .update({
      full_name: fullName,
      phone: input.phone?.trim() || null,
    })
    .eq("id", userId);

  if (result.error) return { ok: false, error: result.error.message };

  revalidatePath("/perfil");
  return { ok: true };
}

export type UpdatePreferencesInput = {
  operation?: "alquiler" | "venta";
  stayType?: "corta" | "larga";
  bedrooms?: number;
  budgetMin?: number;
  budgetMax?: number;
  preferredZones: string[];
};

export type UpdatePreferencesResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateClientOwnPreferences(
  input: UpdatePreferencesInput,
): Promise<UpdatePreferencesResult> {
  const supabase = await createClient();
  const auth = await requireSession(supabase);
  if (!auth.ok) return auth;
  const userId = auth.userId;

  const payload = {
    client_id: userId,
    operation: input.operation
      ? input.operation === "alquiler"
        ? "rent"
        : "sale"
      : null,
    stay: input.stayType
      ? input.stayType === "corta"
        ? "short"
        : "long"
      : null,
    min_bedrooms: input.bedrooms ?? null,
    min_price: input.budgetMin ?? null,
    max_price: input.budgetMax ?? null,
    zones: input.preferredZones,
  };

  const existingLookup = await supabase
    .from("client_preferences")
    .select("client_id")
    .eq("client_id", userId)
    .maybeSingle();

  const prefsTbl = supabase.from("client_preferences") as unknown as {
    update: (payload: Record<string, unknown>) => {
      eq: (
        column: string,
        value: string,
      ) => Promise<{ error: { message: string } | null }>;
    };
    insert: (
      payload: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>;
  };

  const writeResult = existingLookup.data
    ? await prefsTbl.update(payload).eq("client_id", userId)
    : await prefsTbl.insert(payload);

  if (writeResult.error) {
    return { ok: false, error: writeResult.error.message };
  }
  revalidatePath("/perfil");
  return { ok: true };
}

export type SendMessageInput = { body: string };
export type SendMessageResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function sendMessage(
  input: SendMessageInput,
): Promise<SendMessageResult> {
  const supabase = await createClient();
  const auth = await requireSession(supabase);
  if (!auth.ok) return auth;
  const userId = auth.userId;

  const body = input.body.trim();
  if (!body) return { ok: false, error: "body_required" };

  // Buscar la conversación del cliente, crearla si no existe.
  const convLookup = await supabase
    .from("conversations")
    .select("id")
    .eq("client_id", userId)
    .maybeSingle();
  let conversationId = (convLookup.data as { id: string } | null)?.id;

  if (!conversationId) {
    const convTbl = supabase.from("conversations") as unknown as {
      insert: (payload: Record<string, unknown>) => {
        select: (cols: string) => {
          maybeSingle: () => Promise<{
            data: { id: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    const created = await convTbl
      .insert({
        client_id: userId,
        last_message_at: new Date().toISOString(),
        unread_count_advisor: 1,
      })
      .select("id")
      .maybeSingle();
    if (created.error) return { ok: false, error: created.error.message };
    if (!created.data) return { ok: false, error: "conversation_create_failed" };
    conversationId = created.data.id;
  }

  const msgsTbl = supabase.from("messages") as unknown as {
    insert: (payload: Record<string, unknown>) => {
      select: (cols: string) => {
        maybeSingle: () => Promise<{
          data: { id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  const inserted = await msgsTbl
    .insert({
      conversation_id: conversationId,
      sender_id: userId,
      sender_type: "client",
      body,
    })
    .select("id")
    .maybeSingle();

  if (inserted.error) return { ok: false, error: inserted.error.message };
  if (!inserted.data) return { ok: false, error: "insert_no_row" };

  // Actualizar last_message_at + incrementar unread_count_advisor.
  const convUpdate = supabase.from("conversations") as unknown as {
    update: (payload: Record<string, unknown>) => {
      eq: (
        column: string,
        value: string,
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
  await convUpdate
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);

  revalidatePath("/mensajes");
  return { ok: true, id: inserted.data.id };
}

export type RequestVisitInput = {
  slug: string;
  requestedAt: string; // ISO datetime
  notes?: string;
};

export type RequestVisitResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function requestVisit(
  input: RequestVisitInput,
): Promise<RequestVisitResult> {
  const supabase = await createClient();
  const auth = await requireSession(supabase);
  if (!auth.ok) return auth;
  const userId = auth.userId;

  const propLookup = await supabase
    .from("properties")
    .select("id")
    .eq("slug", input.slug)
    .maybeSingle();
  const propRow = propLookup.data as { id: string } | null;
  if (!propRow) return { ok: false, error: "property_not_found" };

  if (!input.requestedAt) return { ok: false, error: "date_required" };

  const visitsTbl = supabase.from("visit_requests") as unknown as {
    insert: (payload: Record<string, unknown>) => {
      select: (cols: string) => {
        maybeSingle: () => Promise<{
          data: { id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };

  const insertResult = await visitsTbl
    .insert({
      client_id: userId,
      property_id: propRow.id,
      requested_at: input.requestedAt,
      status: "pending",
      notes: input.notes?.trim() || null,
    })
    .select("id")
    .maybeSingle();

  if (insertResult.error) return { ok: false, error: insertResult.error.message };
  if (!insertResult.data) return { ok: false, error: "insert_no_row" };

  revalidatePath("/admin/solicitudes");
  return { ok: true, id: insertResult.data.id };
}
