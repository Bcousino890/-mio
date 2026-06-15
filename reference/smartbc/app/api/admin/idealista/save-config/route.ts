import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { getCurrentProfile } from "@/lib/db/queries/session";

export async function POST(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["owner", "admin"].includes(profile.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { feedKey, clientId, clientSecret, sandboxMode } = await req.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any;

    const { data: existing } = await db
      .from("idealista_config")
      .select("id")
      .limit(1)
      .single();

    if (existing) {
      await db
        .from("idealista_config")
        .update({
          feed_key: feedKey,
          client_id: clientId,
          client_secret: clientSecret,
          sandbox_mode: sandboxMode ?? true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await db.from("idealista_config").insert({
        feed_key: feedKey,
        client_id: clientId,
        client_secret: clientSecret,
        sandbox_mode: sandboxMode ?? true,
      });
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Save config error:", error);
    return Response.json({ error: "Error al guardar configuración" }, { status: 500 });
  }
}
