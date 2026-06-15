import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { getCurrentProfile } from "@/lib/db/queries/session";

export async function PATCH(req: Request) {
  let body: {
    userId: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    role?: "owner" | "admin" | "advisor" | "agent_junior" | "agent_senior" | "agent_admin" | "client";
    password?: string;
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Cuerpo JSON inválido" }, { status: 400 });
  }

  const { userId, firstName, lastName, phone, role, password } = body;

  if (!userId) {
    return Response.json({ error: "userId requerido" }, { status: 400 });
  }

  const currentProfile = await getCurrentProfile();
  if (!currentProfile) {
    return Response.json({ error: "No autenticado" }, { status: 401 });
  }

  if (!["owner", "admin", "agent_admin"].includes(currentProfile.role)) {
    return Response.json({ error: "Solo owner/admin pueden editar usuarios" }, { status: 403 });
  }

  const supabase = createAdminClient();

  const updates: Record<string, string> = {};
  if (firstName !== undefined || lastName !== undefined) {
    const fullName = `${firstName ?? ""} ${lastName ?? ""}`.trim();
    if (fullName) updates.full_name = fullName;
  }
  if (role !== undefined) updates.role = role;
  if (phone !== undefined) updates.phone = phone;

  if (Object.keys(updates).length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("profiles")
      .update(updates)
      .eq("id", userId);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }

  if (password) {
    const { error } = await supabase.auth.admin.updateUserById(userId, { password });
    if (error) {
      return Response.json({ error: `Error cambiando contraseña: ${error.message}` }, { status: 500 });
    }
  }

  return Response.json({ ok: true });
}
