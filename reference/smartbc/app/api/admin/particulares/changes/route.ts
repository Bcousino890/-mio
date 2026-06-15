import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getCurrentProfile } from "@/lib/db/queries/session";

export const dynamic = "force-dynamic";

// Historial de cambios de un anuncio de particular (tabla particulares_changes,
// escrita por el cron de scrape). Solo sesión de staff — se consume desde el
// modal de detalle en /admin/particulares.

const STAFF_ROLES = [
  "owner",
  "admin",
  "advisor",
  "agent_admin",
  "agent_senior",
  "agent_junior",
];

export async function GET(req: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile || !STAFF_ROLES.includes(profile.role as string)) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  } catch {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return Response.json({ ok: false, error: "id requerido" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await supabase
    .from("particulares_changes")
    .select("id, change_type, old_value, new_value, changed_at")
    .eq("particular_id", id)
    .order("changed_at", { ascending: false })
    .limit(200);

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, changes: data ?? [] });
}
