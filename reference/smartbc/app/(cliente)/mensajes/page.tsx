import { redirect } from "next/navigation";
import { MensajesClient, type ThreadMessage } from "./mensajes-client";
import { createClient } from "@/lib/db/server";
import { getCurrentUser } from "@/lib/db/queries/session";

export const dynamic = "force-dynamic";

export default async function MensajesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  // Conversación del cliente (puede no existir aún).
  const convResult = await supabase
    .from("conversations")
    .select("id")
    .eq("client_id", user.id)
    .maybeSingle();
  const conversationId =
    (convResult.data as { id: string } | null)?.id ?? null;

  let messages: ThreadMessage[] = [];
  if (conversationId) {
    const msgResult = await supabase
      .from("messages")
      .select("id, body, sender_id, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    const rows = (msgResult.data ?? []) as Array<{
      id: string;
      body: string;
      sender_id: string;
      created_at: string;
    }>;
    messages = rows.map((m) => ({
      id: m.id,
      body: m.body,
      fromMe: m.sender_id === user.id,
      time: formatTime(m.created_at),
    }));
  }

  return (
    <MensajesClient messages={messages} hasConversation={!!conversationId} />
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
