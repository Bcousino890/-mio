import "server-only";
import { getCurrentProfile } from "@/lib/db/queries/session";
import { createAdminClient } from "@/lib/db/admin";
import { createDecipheriv, scryptSync } from "crypto";

const ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY || "default-insecure-key-change-this";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodemailer = require('nodemailer');

function decryptPasswordFromIv(encrypted: string, iv: string): string {
  try {
    const [ciphertext, authTag] = encrypted.split(":");
    const key = scryptSync(ENCRYPTION_KEY, "salt", 32);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "hex")
    );

    decipher.setAuthTag(Buffer.from(authTag, "hex"));

    let decrypted = decipher.update(ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error("Failed to decrypt password");
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
    } = body;

    // If no password provided, fetch from DB
    let password = smtpPassword;
    if (!password) {
      const supabase = createAdminClient() as any;
      const { data } = await supabase
        .from("email_config")
        .select("*")
        .limit(1)
        .single();

      if (data) {
        password = decryptPasswordFromIv(
          data.smtp_password_encrypted,
          data.smtp_password_iv
        );
      }
    }

    if (!password) {
      return Response.json(
        { error: "No password provided or stored" },
        { status: 400 }
      );
    }

    // Create transporter and test connection
    const transporter = nodemailer.createTransport({
      host: smtpServer,
      port: smtpPort,
      secure: useSsl !== false,
      auth: {
        user: smtpUser,
        pass: password,
      },
    });

    await transporter.verify();

    return Response.json({ ok: true, message: "Conexión SMTP exitosa" });
  } catch (error) {
    console.error("Error testing SMTP connection:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to connect" },
      { status: 400 }
    );
  }
}
