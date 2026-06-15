import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { getCurrentProfile } from "@/lib/db/queries/session";

export type NotificationItem = {
  id: string;
  type: "visit" | "message";
  title: string;
  subtitle: string;
  created_at: string;
  href: string;
};

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return Response.json([], { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [visits, messages] = await Promise.all([
    db
      .from("visit_requests")
      .select(
        "id, created_at, status, profiles!visit_requests_client_id_fkey(full_name), properties(title, bc_reference)"
      )
      .eq("status", "pending")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10),
    db
      .from("team_direct_messages")
      .select(
        "id, content, created_at, sender_id, profiles!team_direct_messages_sender_id_fkey(full_name)"
      )
      .neq("sender_id", profile.id)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notifications: NotificationItem[] = [
    ...(visits.data ?? []).map((v: any) => ({
      id: `visit-${v.id}`,
      type: "visit" as const,
      title: `Visita: ${v.properties?.title ?? "Propiedad"}`,
      subtitle: `${v.profiles?.full_name ?? "Cliente"} solicitó una visita`,
      created_at: v.created_at,
      href: "/admin/calendario",
    })),
    ...(messages.data ?? []).map((m: any) => ({
      id: `msg-${m.id}`,
      type: "message" as const,
      title: `Mensaje de ${m.profiles?.full_name ?? "Usuario"}`,
      subtitle:
        m.content.slice(0, 60) + (m.content.length > 60 ? "..." : ""),
      created_at: m.created_at,
      href: "/admin/mensajes?tab=equipo",
    })),
  ].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return Response.json(notifications);
}
