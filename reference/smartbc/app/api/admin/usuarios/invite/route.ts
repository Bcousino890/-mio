import "server-only";
import { createAdminClient } from "@/lib/db/admin";

export async function POST(req: Request) {
  let body: { email: string; role: string; firstName?: string; lastName?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Cuerpo JSON inválido" }, { status: 400 });
  }

  const { email, role, firstName, lastName } = body;
  if (!email || !role) {
    return Response.json({ error: "Email y rol son obligatorios" }, { status: 400 });
  }

  const validRoles = ["owner", "admin", "advisor", "agent_junior", "agent_senior", "agent_admin", "client", "viewer"];
  if (!validRoles.includes(role)) {
    return Response.json({ error: "Rol inválido" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Envía email de invitación. Supabase crea el usuario con estado "invited".
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: {
      role,
      first_name: firstName ?? "",
      last_name: lastName ?? "",
    },
  });

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ ok: true, userId: data.user?.id });
}
