import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { getCurrentProfile } from "@/lib/db/queries/session";

/**
 * POST /api/admin/team/direct/mark-read
 * Body: { conversationId: string }
 * Upserts the user's read timestamp for the given conversation.
 */
export async function POST(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role === "client") {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: { conversationId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { conversationId } = body;
  if (!conversationId) {
    return Response.json({ error: "conversationId requerido" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any;

  // Verify the user is a participant
  const { data: conv } = await sb
    .from("team_direct_conversations")
    .select("id")
    .eq("id", conversationId)
    .or(
      `participant_a.eq.${profile.id},participant_b.eq.${profile.id}`,
    )
    .maybeSingle() as { data: { id: string } | null };

  if (!conv) {
    return Response.json({ error: "Conversación no encontrada o sin acceso" }, { status: 404 });
  }

  const { error } = await sb
    .from("team_conversation_reads")
    .upsert(
      { user_id: profile.id, conversation_id: conversationId, read_at: new Date().toISOString() },
      { onConflict: "user_id,conversation_id" },
    );

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
