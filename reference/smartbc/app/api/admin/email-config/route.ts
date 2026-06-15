import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { getCurrentProfile } from "@/lib/db/queries/session";
import { createCipheriv, randomBytes, scryptSync } from "crypto";

const ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY || "default-insecure-key-change-this";

function encryptPassword(text: string): { encrypted: string; iv: string } {
  const iv = randomBytes(16).toString("hex");
  const key = scryptSync(ENCRYPTION_KEY, "salt", 32);
  const cipher = createCipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");
  return {
    encrypted: `${encrypted}:${authTag}`,
    iv,
  };
}

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile || !["admin", "owner"].includes(profile.role)) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const supabase = createAdminClient() as any;

    const { data, error } = await supabase
      .from("email_config")
      .select("*")
      .limit(1)
      .single();

    if (error || !data) {
      return Response.json({ config: null }, { status: 200 });
    }

    return Response.json({
      config: {
        id: data.id,
        smtpServer: data.smtp_server,
        smtpPort: data.smtp_port,
        smtpUser: data.smtp_user,
        useSsl: data.use_ssl,
        fromEmail: data.from_email,
        fromName: data.from_name,
      },
    });
  } catch (error) {
    console.error("Error fetching email config:", error);
    return Response.json(
      { error: "Failed to fetch config" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile || !["admin", "owner"].includes(profile.role)) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      smtpServer,
      smtpPort,
      smtpUser,
      smtpPassword,
      useSsl,
      fromEmail,
      fromName,
    } = body;

    if (!smtpServer || !smtpPort || !smtpUser || !smtpPassword || !fromEmail) {
      return Response.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const { encrypted, iv } = encryptPassword(smtpPassword);
    const supabase = createAdminClient() as any;

    // Check if config already exists
    const { data: existing } = await supabase
      .from("email_config")
      .select("id")
      .limit(1)
      .single();

    if (existing) {
      // Update existing config
      const { error } = await supabase
        .from("email_config")
        .update({
          smtp_server: smtpServer,
          smtp_port: smtpPort,
          smtp_user: smtpUser,
          smtp_password_encrypted: encrypted,
          smtp_password_iv: iv,
          use_ssl: useSsl !== false,
          from_email: fromEmail,
          from_name: fromName || "SmartBC",
        })
        .eq("id", existing.id);

      if (error) {
        console.error("Error updating email config:", error);
        return Response.json(
          { error: "Failed to update config" },
          { status: 500 }
        );
      }
    } else {
      // Create new config
      const { error } = await supabase.from("email_config").insert({
        smtp_server: smtpServer,
        smtp_port: smtpPort,
        smtp_user: smtpUser,
        smtp_password_encrypted: encrypted,
        smtp_password_iv: iv,
        use_ssl: useSsl !== false,
        from_email: fromEmail,
        from_name: fromName || "SmartBC",
      });

      if (error) {
        console.error("Error creating email config:", error);
        return Response.json(
          { error: "Failed to create config" },
          { status: 500 }
        );
      }
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Error handling email config:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
