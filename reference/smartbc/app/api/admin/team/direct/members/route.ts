import "server-only";
import { createClient } from "@/lib/db/server";
import { getCurrentProfile } from "@/lib/db/queries/session";

const STAFF_ROLES = [
  "admin",
  "advisor",
  "agent_junior",
  "agent_senior",
  "agent_admin",
] as const;

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role === "client") {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data, error } = await sb
    .from("profiles")
    .select("id, full_name, email, role")
    .in("role", STAFF_ROLES)
    .neq("id", profile.id)
    .order("full_name", { ascending: true }) as {
    data: Array<{
      id: string;
      full_name: string | null;
      email: string;
      role: string;
    }> | null;
    error: { message: string } | null;
  };

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const members = (data ?? []).map((m) => {
    const display = m.full_name?.trim() || m.email || "—";
    const parts = display.split(/\s+/);
    const initials = (
      (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")
    )
      .toUpperCase()
      .slice(0, 2);
    return {
      id: m.id,
      name: display,
      initials: initials || "?",
      email: m.email,
      role: m.role,
    };
  });

  return Response.json({ members });
}
