import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { getCurrentProfile } from "@/lib/db/queries/session";

export async function POST() {
  const profile = await getCurrentProfile();
  if (!profile) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["owner", "admin"].includes(profile.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const supabase = createAdminClient();

    const { data: config } = await (supabase
      .from("idealista_config")
      .select("*")
      .limit(1)
      .single() as any);

    if (!config) {
      return Response.json({ error: "No hay configuración guardada" }, { status: 400 });
    }

    const { client_id, client_secret, feed_key, sandbox_mode } = config as any;

    if (!client_id || !client_secret) {
      return Response.json({ error: "Faltan credenciales (client_id / client_secret)" }, { status: 400 });
    }

    const baseUrl = sandbox_mode
      ? "https://partners-sandbox.idealista.com"
      : "https://partners.idealista.com";

    const credentials = Buffer.from(`${client_id}:${client_secret}`).toString("base64");

    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: "grant_type=client_credentials&scope=write",
    });

    const rawBody = await tokenRes.text();

    if (!tokenRes.ok) {
      return Response.json(
        { error: `Auth error ${tokenRes.status}`, details: rawBody },
        { status: 401 }
      );
    }

    const tokenData = JSON.parse(rawBody);

    return Response.json({
      ok: true,
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in,
      scope: tokenData.scope,
      feedKey: feed_key,
      sandbox: sandbox_mode,
    });
  } catch (error) {
    console.error("Test connection error:", error);
    return Response.json({ error: "Error de red o configuración" }, { status: 500 });
  }
}
