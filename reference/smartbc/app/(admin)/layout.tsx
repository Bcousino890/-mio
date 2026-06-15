import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin-sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { createClient } from "@/lib/db/server";
import { createAdminClient } from "@/lib/db/admin";
import { getCurrentProfile } from "@/lib/db/queries/session";
import { getEffectivePermissions } from "@/lib/db/queries/permissions";
import { isStaffRole } from "@/lib/permissions";
import type { AdminUser } from "@/lib/types";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!isStaffRole(profile.role)) redirect("/inicio");

  const adminUser = profileToAdminUser(profile.full_name, profile.email, profile.role);

  // Permisos efectivos = defaults del rol + excepciones por usuario
  // (user_permission_overrides). El sidebar oculta los módulos sin "view".
  const permissions = await getEffectivePermissions(profile.id, profile.role);

  // Obtener visitas pendientes para el badge del sidebar
  // Wrapped in try-catch: migration 0027 may not be applied yet on the VPS
  let pendingVisits: number = 0;
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("visit_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    pendingVisits = count ?? 0;
  } catch {
    // Silently default to 0 if the query fails (e.g. missing column from migration 0027)
  }

  // Obtener mensajes directos no leídos para el badge del sidebar
  // Wrapped in try-catch: migration 0030 may not be applied yet on the VPS
  let unreadMessages: number = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createAdminClient() as any;

    // Get all conversations for this user
    const { data: convs } = await sb
      .from("team_direct_conversations")
      .select("id")
      .or(`participant_a.eq.${profile.id},participant_b.eq.${profile.id}`) as {
      data: Array<{ id: string }> | null;
    };

    if (convs && convs.length > 0) {
      const convIds = convs.map((c: { id: string }) => c.id);

      // Get last read timestamps for this user
      const { data: reads } = await sb
        .from("team_conversation_reads")
        .select("conversation_id, read_at")
        .eq("user_id", profile.id)
        .in("conversation_id", convIds) as {
        data: Array<{ conversation_id: string; read_at: string }> | null;
      };

      const readMap = new Map<string, string>(
        (reads ?? []).map((r: { conversation_id: string; read_at: string }) => [
          r.conversation_id,
          r.read_at,
        ]),
      );

      // Count unread per conversation
      await Promise.all(
        convIds.map(async (convId: string) => {
          const lastRead = readMap.get(convId);
          let q = sb
            .from("team_direct_messages")
            .select("id", { count: "exact", head: true })
            .eq("conversation_id", convId)
            .neq("sender_id", profile.id);
          if (lastRead) q = q.gt("created_at", lastRead);
          const { count } = (await q) as { count: number | null };
          if (count && count > 0) unreadMessages += count;
        }),
      );
    }
  } catch {
    // Silently default to 0 if the query fails (e.g. missing migration 0030)
  }

  return (
    <div className="relative min-h-screen bg-cream-50">
      {/* Soft warm background */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-[linear-gradient(135deg,#fbf8f3_0%,#f1e9d6_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -left-40 -top-40 z-0 h-[640px] w-[640px] rounded-full bg-[radial-gradient(circle_at_center,rgba(255,235,190,0.45),transparent_70%)] blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -right-32 bottom-0 z-0 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,rgba(201,169,110,0.20),transparent_70%)] blur-3xl"
      />

      <div className="relative z-10">
        <AdminSidebar user={adminUser} currentRole={profile.role} permissions={permissions} pendingVisits={pendingVisits ?? 0} unreadMessages={unreadMessages} />
        {/* En mobile no hay margen izquierdo (el sidebar está oculto).
            En desktop (lg+) añadimos ml-[260px] para dejar espacio al sidebar fijo.
            En mobile añadimos pt-16 para que el contenido no quede tapado por el botón hamburger (h-10 + top-4 = 56px). */}
        <main className="min-h-screen pt-16 lg:ml-[260px] lg:pt-0">
          <ToastProvider>{children}</ToastProvider>
        </main>
      </div>
    </div>
  );
}

const ROLE_KEY_MAP: Record<string, string> = {
  owner: "admin.role.owner",
  admin: "admin.role",
  advisor: "admin.role.advisor",
  agent_admin: "admin.role.agent_admin",
  agent_senior: "admin.role.agent_senior",
  agent_junior: "admin.role.agent_junior",
};

function profileToAdminUser(
  fullName: string | null,
  email: string,
  role: string,
): AdminUser {
  const display = fullName?.trim() || email;
  const parts = display.split(/\s+/);
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ");
  const initials = (
    (firstName[0] ?? "") + (lastName[0] ?? firstName[1] ?? "")
  ).toUpperCase() || display.slice(0, 2).toUpperCase();
  return {
    firstName,
    lastName,
    initials,
    roleKey: ROLE_KEY_MAP[role] ?? "admin.role.advisor",
  };
}
