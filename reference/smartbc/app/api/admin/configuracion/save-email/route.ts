import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { createCipheriv, randomBytes, scryptSync } from "crypto";

const ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY || "default-insecure-key-change-this";

/**
 * Encrypt password using AES-256-GCM
 */
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

export async function POST(req: Request) {
  try {
    const {
      smtpServer,
      smtpPort,
      smtpUser,
      smtpPassword,
      useSsl,
      fromEmail,
      fromName,
    } = await req.json();

    // Validation
    if (!smtpServer || !smtpPort || !smtpUser || !smtpPassword || !fromEmail) {
      return Response.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Encrypt password
    const { encrypted: encryptedPassword, iv } = encryptPassword(smtpPassword);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any;

    // Check if config exists
    const { data: existing } = await db
      .from("email_config")
      .select("id")
      .limit(1)
      .single();

    if (existing) {
      // Update existing config
      await db
        .from("email_config")
        .update({
          smtp_server: smtpServer,
          smtp_port: smtpPort,
          smtp_user: smtpUser,
          smtp_password_encrypted: encryptedPassword,
          smtp_password_iv: iv,
          use_ssl: useSsl ?? true,
          from_email: fromEmail,
          from_name: fromName || "SmartBC",
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      // Insert new config
      await db.from("email_config").insert({
        smtp_server: smtpServer,
        smtp_port: smtpPort,
        smtp_user: smtpUser,
        smtp_password_encrypted: encryptedPassword,
        smtp_password_iv: iv,
        use_ssl: useSsl ?? true,
        from_email: fromEmail,
        from_name: fromName || "SmartBC",
      });
    }

    return Response.json({ ok: true, message: "Email config saved successfully" });
  } catch (error) {
    console.error("Save email config error:", error);
    return Response.json(
      { error: "Error saving email configuration" },
      { status: 500 }
    );
  }
}
