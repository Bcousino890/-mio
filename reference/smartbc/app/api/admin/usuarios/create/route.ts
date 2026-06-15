import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { getCurrentProfile } from "@/lib/db/queries/session";

export async function POST(req: Request) {
  let body: {
    email: string;
    firstName: string;
    lastName?: string;
    phone?: string;
    role: "owner" | "admin" | "advisor" | "agent_junior" | "agent_senior" | "agent_admin" | "client";
    password?: string;
    assignedAdvisorId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Cuerpo JSON inválido" }, { status: 400 });
  }

  const {
    email,
    firstName,
    lastName = "",
    phone,
    role: roleInput,
    password,
    assignedAdvisorId,
  } = body;

  const role = roleInput;

  // Validaciones básicas
  if (!email || !firstName) {
    return Response.json(
      { error: "Email y nombre son obligatorios" },
      { status: 400 }
    );
  }

  const validRoles = ["owner", "admin", "advisor", "agent_junior", "agent_senior", "agent_admin", "client"];
  if (!validRoles.includes(role)) {
    return Response.json({ error: "Rol inválido" }, { status: 400 });
  }

  // Obtener perfil actual para validar permisos
  const currentProfile = await getCurrentProfile();
  if (!currentProfile) {
    return Response.json(
      { error: "No autenticado" },
      { status: 401 }
    );
  }

  const isOwnerOrAdmin = ["owner", "admin", "agent_admin"].includes(currentProfile.role);
  const isAdvisorOrAgent = ["advisor", "agent_junior", "agent_senior"].includes(currentProfile.role);

  // Validar permisos: solo owner/admin/agent_admin pueden crear staff
  if (!isOwnerOrAdmin && !isAdvisorOrAgent) {
    return Response.json(
      { error: "No tienes permisos para crear usuarios" },
      { status: 403 }
    );
  }

  if (isAdvisorOrAgent && role !== "client") {
    return Response.json(
      { error: "Los asesores y agentes solo pueden crear clientes" },
      { status: 403 }
    );
  }

  // Contraseña obligatoria para roles de staff (no clients — estos reciben invitación)
  const staffRoles = ["owner", "admin", "advisor", "agent_junior", "agent_senior", "agent_admin"];
  if (staffRoles.includes(role) && !password) {
    return Response.json(
      { error: "La contraseña es obligatoria para crear usuarios de tipo staff" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Crear usuario en auth
  let userId: string = "";
  let authError: string | null = null;

  if (role === "client") {
    // Clientes reciben email de invitación (sin contraseña)
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: {
        first_name: firstName,
        last_name: lastName,
        phone,
      },
    });

    if (error) {
      authError = error.message;
    } else {
      userId = data.user?.id || "";
    }
  } else {
    // Staff (owner, admin, advisor, agent_*): crear con contraseña confirmada
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: `${firstName} ${lastName}`.trim(),
        first_name: firstName,
        last_name: lastName,
      },
    });

    if (error) {
      authError = error.message;
    } else {
      userId = data.user?.id || "";
    }
  }

  if (authError) {
    return Response.json({ error: authError }, { status: 400 });
  }

  if (!userId) {
    return Response.json(
      { error: "Error creando usuario" },
      { status: 500 }
    );
  }

  // Actualizar profile con rol y email usando el cliente admin (service role) para bypassear RLS
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profileUpdate: Record<string, any> = {
    role,
    email,
  };

  if (role === "client") {
    profileUpdate.assigned_advisor_id = assignedAdvisorId || null;
    if (phone) {
      profileUpdate.phone = phone;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: profileError } = await (supabase as any)
    .from("profiles")
    .update(profileUpdate)
    .eq("id", userId);

  if (profileError) {
    return Response.json(
      { error: `Error actualizando perfil: ${profileError.message}` },
      { status: 500 }
    );
  }

  return Response.json({
    ok: true,
    userId,
    role,
    email,
  });
}
