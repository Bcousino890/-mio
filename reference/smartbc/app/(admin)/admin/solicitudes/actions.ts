"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/db/admin";
import { requireStaff } from "@/lib/db/auth-helpers";
import { createClient } from "@/lib/db/server";

export async function updateVisitStatus(
  id: string,
  status: "confirmed" | "cancelled" | "completed",
) {
  // Server actions son endpoints públicos: verificar que quien llama es staff
  // antes de tocar nada con el cliente service-role.
  const session = await createClient();
  const auth = await requireStaff(session);
  if (!auth.ok) return { ok: false, error: auth.error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient() as any;
  const { error } = await supabase
    .from("visit_requests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("updateVisitStatus error:", error);
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/solicitudes");
  return { ok: true };
}
