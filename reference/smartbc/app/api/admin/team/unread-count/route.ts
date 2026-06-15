import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { getCurrentProfile } from "@/lib/db/queries/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/team/unread-count
 * Returns the total count of unread direct messages for the current user.
 * A message is "unread" when its created_at > the user's last read_at for
 * that conversation (or when no read record exists at all).
 */
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role === "client") {
    return Response.json({ unread: 0 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any;

  // 1. Get all conversations for this user
  const { data: convs } = await sb
    .from("team_direct_conversations")
    .select("id")
    .or(
      `participant_a.eq.${profile.id},participant_b.eq.${profile.id}`,
    ) as { data: Array<{ id: string }> | null };

  if (!convs || convs.length === 0) {
    return Response.json({ unread: 0 });
  }

  const convIds = convs.map((c) => c.id);

  // 2. Get last read timestamp per conversation for this user
  const { data: reads } = await sb
    .from("team_conversation_reads")
    .select("conversation_id, read_at")
    .eq("user_id", profile.id)
    .in("conversation_id", convIds) as {
    data: Array<{ conversation_id: string; read_at: string }> | null;
  };

  const readMap = new Map<string, string>(
    (reads ?? []).map((r) => [r.conversation_id, r.read_at]),
  );

  // 3. For each conversation, count unread messages (not sent by me, after last read)
  let totalUnread = 0;

  await Promise.all(
    convIds.map(async (convId) => {
      const lastRead = readMap.get(convId);

      let query = sb
        .from("team_direct_messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", convId)
        .neq("sender_id", profile.id);

      if (lastRead) {
        query = query.gt("created_at", lastRead);
      }

      const { count } = (await query) as { count: number | null };
      if (count && count > 0) totalUnread += count;
    }),
  );

  return Response.json({ unread: totalUnread });
}
