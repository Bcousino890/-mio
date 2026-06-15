"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/db/auth-helpers";
import { createClient } from "@/lib/db/server";

export type SaveAgencyPartnershipInput = {
  slug: string;
  rentCommissionMinPrice: number;
  saleAgreedCommissionPct: number;
};

export type SaveAgencyPartnershipResult =
  | { ok: true }
  | { ok: false; error: string };

export async function saveAgencyPartnership(
  input: SaveAgencyPartnershipInput,
): Promise<SaveAgencyPartnershipResult> {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth;

  const agencyResult = await supabase
    .from("agencies")
    .select("id")
    .eq("slug", input.slug)
    .maybeSingle();

  if (agencyResult.error) {
    return { ok: false, error: agencyResult.error.message };
  }
  const agencyRow = agencyResult.data as { id: string } | null;
  if (!agencyRow) return { ok: false, error: "agency_not_found" };
  const agencyId = agencyRow.id;

  // La comisión efectiva de venta es la mitad de la acordada.
  const saleEffectivePct = input.saleAgreedCommissionPct / 2;

  // Comprueba si ya existe el partnership para decidir entre UPDATE o INSERT.
  const existingResult = await supabase
    .from("agency_partnerships")
    .select("id")
    .eq("agency_id", agencyId)
    .maybeSingle();

  const existingRow = existingResult.data as { id: string } | null;

  const payload = {
    rent_commission_min_price: input.rentCommissionMinPrice,
    sale_agreed_commission_pct: input.saleAgreedCommissionPct,
    sale_commission_pct: saleEffectivePct,
  };

  // supabase-js no infiere bien Insert/Update tras chains tipadas. Tratamos
  // la tabla como cliente untyped solo para esta mutación puntual.
  const partnerships = supabase.from("agency_partnerships") as unknown as {
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
    ? await partnerships.update(payload).eq("agency_id", agencyId)
    : await partnerships.insert({ agency_id: agencyId, ...payload });

  if (writeResult.error) {
    return { ok: false, error: writeResult.error.message };
  }

  revalidatePath(`/admin/agencias/${input.slug}`);
  revalidatePath("/admin/agencias");
  return { ok: true };
}
