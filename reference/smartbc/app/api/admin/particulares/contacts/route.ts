import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { requireStaff } from "@/lib/db/auth-helpers";
import { createClient } from "@/lib/db/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await createClient();
  const auth = await requireStaff(session);
  if (!auth.ok) {
    return Response.json(
      { error: "Unauthorized" },
      { status: auth.error === "no_session" ? 401 : 403 },
    );
  }

  const url = new URL(req.url);
  const particularId = url.searchParams.get("id");
  if (!particularId) return Response.json({ error: "id_required" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;
  // OJO: profiles solo tiene `full_name` (ver 0001_init.sql), no
  // first_name/last_name. Mapeamos al shape {first_name, last_name} que
  // espera el cliente para no romper su contrato.
  const { data, error } = await db
    .from("particulares_contacts")
    .select("id, contact_type, outcome, notes, contacted_at, advisor_id, profiles(full_name)")
    .eq("particular_id", particularId)
    .order("contacted_at", { ascending: false })
    .limit(50);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const contacts = ((data ?? []) as Array<
    Record<string, unknown> & { profiles: { full_name: string | null } | null }
  >).map((c) => ({
    ...c,
    profiles: c.profiles
      ? { first_name: c.profiles.full_name, last_name: null }
      : null,
  }));

  return Response.json({ contacts });
}
