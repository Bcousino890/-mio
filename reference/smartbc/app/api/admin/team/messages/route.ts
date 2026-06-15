import "server-only";
import { createClient } from "@/lib/db/server";
import { getCurrentProfile } from "@/lib/db/queries/session";

export async function GET(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role === "client") {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(req.url);
  const channelId = url.searchParams.get("channelId");
  if (!channelId) {
    return Response.json({ error: "channelId requerido" }, { status: 400 });
  }

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbGet = supabase as any;
  type Row = {
    id: string;
    content: string;
    created_at: string;
    reply_to: string | null;
    user_id: string;
    profiles: { full_name: string | null; email: string } | null;
  };

  const { data, error } = await sbGet
    .from("team_messages")
    .select(
      "id, content, created_at, reply_to, user_id, profiles!team_messages_user_id_fkey(full_name, email)"
    )
    .eq("channel_id", channelId)
    .order("created_at", { ascending: true })
    .limit(200) as { data: Row[] | null; error: { message: string } | null };

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
      replyTo: row.reply_to,
      userId: row.user_id,
      userName: display,
      userInitials: initials || "?",
    };
  });

  return Response.json({ messages });
}

export async function POST(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role === "client") {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: { channelId: string; content: string; replyTo?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Cuerpo JSON inválido" }, { status: 400 });
  }

  const { channelId, content, replyTo } = body;
  if (!channelId || !content?.trim()) {
    return Response.json(
      { error: "channelId y content son obligatorios" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb
    .from("team_messages")
    .insert({
      channel_id: channelId,
      user_id: profile.id,
      content: content.trim(),
      reply_to: replyTo ?? null,
    })
    .select("id, content, created_at, reply_to, user_id")
    .single() as { data: { id: string; content: string; created_at: string; reply_to: string | null; user_id: string } | null; error: { message: string } | null };

  if (error || !data) {
    return Response.json({ error: error?.message ?? "insert_failed" }, { status: 500 });
  }

  const display = profile.full_name?.trim() || profile.email || "—";
  const parts = display.split(/\s+/);
  const initials = (
    (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")
  )
    .toUpperCase()
    .slice(0, 2);

  return Response.json({
    ok: true,
    message: {
      id: data.id,
      content: data.content,
      createdAt: data.created_at,
      replyTo: data.reply_to,
      userId: data.user_id,
      userName: display,
      userInitials: initials || "?",
    },
  });
}
