import "server-only";
import { createClient } from "@/lib/db/server";
import { getCurrentProfile } from "@/lib/db/queries/session";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role === "client") {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Fetch all conversations where current user is participant_a or participant_b
  const { data, error } = await sb
    .from("team_direct_conversations")
    .select(
      `id, participant_a, participant_b, last_message_at,
       profile_a:profiles!team_direct_conversations_participant_a_fkey(id, full_name, email),
       profile_b:profiles!team_direct_conversations_participant_b_fkey(id, full_name, email)`
    )
    .or(`participant_a.eq.${profile.id},participant_b.eq.${profile.id}`)
    .order("last_message_at", { ascending: false, nullsFirst: false }) as {
    data: Array<{
      id: string;
      participant_a: string;
      participant_b: string;
      last_message_at: string | null;
      profile_a: { id: string; full_name: string | null; email: string } | null;
      profile_b: { id: string; full_name: string | null; email: string } | null;
    }> | null;
    error: { message: string } | null;
  };

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const myId = profile.id;

  // For each conversation, get unread count (messages sent by the other person after our last read)
  // Simplified: count messages not sent by me since last 24h as proxy — use a simple count for now
  const conversations = await Promise.all(
    (data ?? []).map(async (conv) => {
      const otherId =
        conv.participant_a === myId ? conv.participant_b : conv.participant_a;
      const otherProfile =
        conv.participant_a === myId ? conv.profile_b : conv.profile_a;
      const otherName =
        otherProfile?.full_name?.trim() || otherProfile?.email || "—";

      // Count unread: messages from the other person (we'll track unread simply as messages from other)
      const { count } = await sb
        .from("team_direct_messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conv.id)
        .eq("sender_id", otherId) as { count: number | null };

      const nameParts = otherName.split(/\s+/);
      const initials = (
        (nameParts[0]?.[0] ?? "") +
        (nameParts[1]?.[0] ?? nameParts[0]?.[1] ?? "")
      )
        .toUpperCase()
        .slice(0, 2);

      return {
        id: conv.id,
        otherId,
        otherName,
        otherInitials: initials || "?",
        lastMessageAt: conv.last_message_at,
        unreadCount: 0, // Simplified: proper unread tracking would need a read-receipts table
      };
    })
  );

  return Response.json({ conversations });
}
