"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/db/auth-helpers";
import { createClient } from "@/lib/db/server";

export type CreateAgencyInput = {
  name: string;
  slug: string;
  website?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  rentCommissionPct?: number;
  saleAgreedCommissionPct?: number;
  rentCommissionMinPrice?: number;
  saleCommissionMinPrice?: number;
  agreementSignedAt?: string; // YYYY-MM-DD
};

export type CreateAgencyResult =
  | { ok: true; slug: string }
  | { ok: false; error: string };

function normalizeSlug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createAgency(
  input: CreateAgencyInput,
): Promise<CreateAgencyResult> {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth;

  const name = input.name.trim();
  if (!name) return { ok: false, error: "name_required" };

  const slug = normalizeSlug(input.slug?.trim() || name);
  if (!slug) return { ok: false, error: "slug_required" };

  // Comprobar duplicados de slug antes de insertar para dar error humano.
  const dupResult = await supabase
    .from("agencies")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (dupResult.data) {
    return { ok: false, error: "slug_duplicate" };
  }

  // supabase-js no infiere bien Insert tras chains tipadas — bypass puntual.
  const agenciesTbl = supabase.from("agencies") as unknown as {
    insert: (
      payload: Record<string, unknown>,
    ) => {
      select: (cols: string) => {
        maybeSingle: () => Promise<{
          data: { id: string; slug: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };

  const insertResult = await agenciesTbl
    .insert({
      name,
      slug,
      website: input.website?.trim() || null,
      contact_name: input.contactName?.trim() || null,
      contact_email: input.contactEmail?.trim() || null,
      contact_phone: input.contactPhone?.trim() || null,
    })
    .select("id, slug")
    .maybeSingle();

  if (insertResult.error) {
    return { ok: false, error: insertResult.error.message };
  }
  if (!insertResult.data) {
    return { ok: false, error: "insert_no_row" };
  }
  const agencyId = insertResult.data.id;

  // Si vienen condiciones de colaboración, crear partnership a la vez.
  const hasPartnership =
    input.rentCommissionPct != null ||
    input.saleAgreedCommissionPct != null ||
    input.rentCommissionMinPrice != null ||
    input.saleCommissionMinPrice != null ||
    !!input.agreementSignedAt;

  if (hasPartnership) {
    const saleAgreed = input.saleAgreedCommissionPct ?? 0;
    const partnershipsTbl = supabase.from("agency_partnerships") as unknown as {
      insert: (
        payload: Record<string, unknown>,
      ) => Promise<{ error: { message: string } | null }>;
    };

    const partnershipResult = await partnershipsTbl.insert({
      agency_id: agencyId,
      rent_commission_pct: input.rentCommissionPct ?? null,
      sale_commission_pct: saleAgreed > 0 ? saleAgreed / 2 : null,
      sale_agreed_commission_pct: saleAgreed > 0 ? saleAgreed : null,
      rent_commission_min_price: input.rentCommissionMinPrice ?? null,
      sale_commission_min_price: input.saleCommissionMinPrice ?? null,
      agreement_signed_at: input.agreementSignedAt || null,
      watermark_required: true,
      attribution_visible: false,
    });

    if (partnershipResult.error) {
      // No revertimos la agencia: el admin puede completar las condiciones
      // después editando desde el detalle. Devolvemos error como aviso.
      return { ok: false, error: partnershipResult.error.message };
    }
  }

  revalidatePath("/admin/agencias");
  return { ok: true, slug: insertResult.data.slug };
}
