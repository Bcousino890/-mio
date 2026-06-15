import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { getCurrentProfile } from "@/lib/db/queries/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile || !["admin", "advisor"].includes(profile.role)) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id requerido" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;

  const { data, error } = await db
    .from("particulares_changes")
    .select("id, change_type, old_value, new_value, changed_at")
    .eq("particular_id", id)
    .order("changed_at", { ascending: false })
    .limit(50);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ changes: data ?? [] });
}
