"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/db/auth-helpers";
import { createClient } from "@/lib/db/server";

export type ReplyToConversationInput = {
  conversationId: string;
  body: string;
};

export type ReplyToConversationResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function replyToConversation(
  input: ReplyToConversationInput,
): Promise<ReplyToConversationResult> {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) return auth;

  const body = input.body.trim();
  if (!body) return { ok: false, error: "body_required" };

  const senderType = auth.role === "admin" ? "admin" : "advisor";

  const msgsTbl = supabase.from("messages") as unknown as {
    insert: (payload: Record<string, unknown>) => {
      select: (cols: string) => {
        maybeSingle: () => Promise<{
          data: { id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };

  const inserted = await msgsTbl
    .insert({
      conversation_id: input.conversationId,
      sender_id: auth.userId,
      sender_type: senderType,
      body,
    })
    .select("id")
    .maybeSingle();

  if (inserted.error) return { ok: false, error: inserted.error.message };
  if (!inserted.data) return { ok: false, error: "insert_no_row" };

  const convTbl = supabase.from("conversations") as unknown as {
    update: (payload: Record<string, unknown>) => {
      eq: (
        column: string,
        value: string,
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
  await convTbl
    .update({
      last_message_at: new Date().toISOString(),
      unread_count_client: 1,
    })
    .eq("id", input.conversationId);

  revalidatePath("/admin/mensajes");
  revalidatePath("/mensajes");
  return { ok: true, id: inserted.data.id };
}
