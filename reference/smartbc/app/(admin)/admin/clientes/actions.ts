"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/db/auth-helpers";
import { createClient } from "@/lib/db/server";
import type { Operation, StayType } from "@/lib/types";

export type SaveClientPreferencesInput = {
  clientId: string;
  operation: Operation;
  stayType: StayType;
  preferredZone: string;
  budgetMin: number;
  budgetMax: number;
  occupants: number;
  students: number;
  workers: number;
  pets: boolean;
};

export type SaveClientPreferencesResult =
  | { ok: true }
  | { ok: false; error: string };

export async function saveClientPreferences(
  input: SaveClientPreferencesInput,
): Promise<SaveClientPreferencesResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  const payload = {
    client_id: input.clientId,
    operation: input.operation === "alquiler" ? "rent" : "sale",
    stay: input.stayType === "corta" ? "short" : "long",
    zones: input.preferredZone ? [input.preferredZone] : [],
    min_price: input.budgetMin,
    max_price: input.budgetMax,
    occupants: input.occupants,
    students: input.students,
    workers: input.workers,
    pets: input.pets,
  };

  // client_preferences tiene PK = client_id, así que UPDATE si existe, INSERT si no.
  const existingResult = await supabase
    .from("client_preferences")
    .select("client_id")
    .eq("client_id", input.clientId)
    .maybeSingle();

  const existingRow = existingResult.data as { client_id: string } | null;

  // supabase-js no infiere bien Insert/Update tras chains tipadas.
  const prefs = supabase.from("client_preferences") as unknown as {
    update: (
      payload: Record<string, unknown>,
    ) => {
      eq: (
        column: string,
        value: string,
      ) => Promise<{ error: { message: string } | null }>;
    };
    insert: (
      payload: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>;
  };

  const writeResult = existingRow
    ? await prefs.update(payload).eq("client_id", input.clientId)
    : await prefs.insert(payload);

  if (writeResult.error) {
    return { ok: false, error: writeResult.error.message };
  }

  revalidatePath("/admin/clientes");
  return { ok: true };
}
