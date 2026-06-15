import "server-only";
import { createClient } from "@/lib/db/server";
import { getCurrentProfile } from "@/lib/db/queries/session";

export async function GET(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role === "client") {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId");
  if (!conversationId) {
    return Response.json({ error: "conversationId requerido" }, { status: 400 });
  }

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Verify user is a participant in this conversation
  const { data: conv, error: convErr } = await sb
    .from("team_direct_conversations")
    .select("id, participant_a, participant_b")
    .eq("id", conversationId)
    .maybeSingle() as {
    data: { id: string; participant_a: string; participant_b: string } | null;
    error: { message: string } | null;
  };

  if (convErr) {
    return Response.json({ error: convErr.message }, { status: 500 });
  }
  if (!conv) {
    return Response.json({ error: "Conversación no encontrada" }, { status: 404 });
  }
  if (conv.participant_a !== profile.id && conv.participant_b !== profile.id) {
    return Response.json({ error: "No autorizado" }, { status: 403 });
  }

  type MsgRow = {
    id: string;
    content: string;
    created_at: string;
    sender_id: string;
    profiles: { full_name: string | null; email: string } | null;
  };

  const { data, error } = await sb
    .from("team_direct_messages")
    .select(
      "id, content, created_at, sender_id, profiles!team_direct_messages_sender_id_fkey(full_name, email)"
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(100) as { data: MsgRow[] | null; error: { message: string } | null };

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const messages = (data ?? []).map((row) => {
    const display =
      row.profiles?.full_name?.trim() || row.profiles?.email || "—";
    const parts = display.split(/\s+/);
    const initials = (
      (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")
    )
      .toUpperCase()
      .slice(0, 2);
    return {
      id: row.id,
      content: row.content,
      createdAt: row.created_at,
      senderId: row.sender_id,
      senderName: display,
      senderInitials: initials || "?",
    };
  });

  return Response.json({ messages });
}

export async function POST(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role === "client") {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: { conversationId?: string; recipientId?: string; content: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Cuerpo JSON inválido" }, { status: 400 });
  }

  const { conversationId, recipientId, content } = body;
  if (!content?.trim()) {
    return Response.json({ error: "content es obligatorio" }, { status: 400 });
  }
  if (!conversationId && !recipientId) {
    return Response.json(
      { error: "Se requiere conversationId o recipientId" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  let convId = conversationId;

  if (!convId && recipientId) {
    // Canonical order: smaller UUID is participant_a
    const a = profile.id < recipientId ? profile.id : recipientId;
    const b = profile.id < recipientId ? recipientId : profile.id;

    // Try to get existing conversation
    const { data: existing } = await sb
      .from("team_direct_conversations")
      .select("id")
      .eq("participant_a", a)
      .eq("participant_b", b)
      .maybeSingle() as { data: { id: string } | null };

    if (existing) {
      convId = existing.id;
    } else {
      // Create a new conversation
      const { data: created, error: createErr } = await sb
        .from("team_direct_conversations")
        .insert({ participant_a: a, participant_b: b })
        .select("id")
        .single() as { data: { id: string } | null; error: { message: string } | null };

      if (createErr || !created) {
        return Response.json(
          { error: createErr?.message ?? "create_failed" },
          { status: 500 }
        );
      }
      convId = created.id;
    }
  }

  // Verify participant
  const { data: conv } = await sb
    .from("team_direct_conversations")
    .select("participant_a, participant_b")
    .eq("id", convId)
    .maybeSingle() as {
    data: { participant_a: string; participant_b: string } | null;
  };

  if (!conv) {
    return Response.json({ error: "Conversación no encontrada" }, { status: 404 });
  }
  if (conv.participant_a !== profile.id && conv.participant_b !== profile.id) {
    return Response.json({ error: "No autorizado" }, { status: 403 });
  }

  // Insert message
  const { data: msg, error: msgErr } = await sb
    .from("team_direct_messages")
    .insert({
      conversation_id: convId,
      sender_id: profile.id,
      content: content.trim(),
    })
    .select("id, content, created_at, sender_id")
    .single() as {
    data: {
      id: string;
      content: string;
      created_at: string;
      sender_id: string;
    } | null;
    error: { message: string } | null;
  };

  if (msgErr || !msg) {
    return Response.json(
      { error: msgErr?.message ?? "insert_failed" },
      { status: 500 }
    );
  }

  // Update last_message_at on the conversation
  await sb
    .from("team_direct_conversations")
    .update({ last_message_at: msg.created_at })
    .eq("id", convId);

  const display = profile.full_name?.trim() || profile.email || "—";
  const parts = display.split(/\s+/);
  const initials = (
    (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")
  )
    .toUpperCase()
    .slice(0, 2);

  return Response.json({
    ok: true,
    conversationId: convId,
    message: {
      id: msg.id,
      content: msg.content,
      createdAt: msg.created_at,
      senderId: msg.sender_id,
      senderName: display,
      senderInitials: initials || "?",
    },
  });
}
