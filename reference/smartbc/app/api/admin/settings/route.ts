import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { getCurrentProfile } from "@/lib/db/queries/session";

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile || !["owner", "admin"].includes(profile.role)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient() as any;
  const { data } = await db.from("app_settings").select("key, value");
  const settings: Record<string, unknown> = {};
  for (const row of data ?? []) {
    settings[row.key] = row.value;
  }
  return Response.json(settings);
}

export async function POST(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile || !["owner", "admin"].includes(profile.role)) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();
  const db = createAdminClient() as any;

  for (const [key, value] of Object.entries(body)) {
    await db
      .from("app_settings")
      .upsert({ key, value }, { onConflict: "key" });
  }

  return Response.json({ ok: true });
}
