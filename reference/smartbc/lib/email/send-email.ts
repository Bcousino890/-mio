import "server-only";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodemailer = require('nodemailer');
import { createAdminClient } from "@/lib/db/admin";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

export interface EmailConfig {
  smtpServer: string;
  smtpPort: number;
  smtpUser: string;
  smtpPasswordEncrypted: string;
  smtpPasswordIv: string;
  useSsl: boolean;
  fromEmail: string;
  fromName?: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

const ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY || "default-insecure-key-change-this";

/**
 * Encrypt password using AES-256-GCM
 */
function encryptPassword(text: string): { encrypted: string; iv: string } {
  const iv = randomBytes(16).toString("hex");
  // Derive key from environment key
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

/**
 * Decrypt password using AES-256-GCM
 */
function decryptPassword(encrypted: string, iv: string): string {
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

/**
 * Fetch email config from database, or fallback to environment variables
 */
export async function getEmailConfig(): Promise<EmailConfig | null> {
  try {
    const db = createAdminClient() as any;

    const { data, error } = await db
      .from("email_config")
      .select("*")
      .limit(1)
      .single();

    if (data) {
      return {
        smtpServer: data.smtp_server,
        smtpPort: data.smtp_port,
        smtpUser: data.smtp_user,
        smtpPasswordEncrypted: data.smtp_password_encrypted,
        smtpPasswordIv: data.smtp_password_iv,
        useSsl: data.use_ssl,
        fromEmail: data.from_email,
        fromName: data.from_name,
      };
    }

    // Fallback: try environment variables (for local development / staging)
    const envSmtpServer = process.env.SMTP_SERVER;
    const envSmtpPort = process.env.SMTP_PORT;
    const envSmtpUser = process.env.SMTP_USER;
    const envSmtpPass = process.env.SMTP_PASSWORD;
    const envFromEmail = process.env.FROM_EMAIL;
    const envUseSsl = process.env.SMTP_USE_SSL !== "false";

    if (envSmtpServer && envSmtpPort && envSmtpUser && envSmtpPass && envFromEmail) {
      console.log("[email] Using SMTP config from environment variables");
      return {
        smtpServer: envSmtpServer,
        smtpPort: parseInt(envSmtpPort, 10),
        smtpUser: envSmtpUser,
        smtpPasswordEncrypted: "", // Not encrypted from env
        smtpPasswordIv: "",
        useSsl: envUseSsl,
        fromEmail: envFromEmail,
        fromName: process.env.FROM_NAME || "SmartBC",
      };
    }

    console.warn("[email] No email config found in database or environment variables");
    return null;
  } catch (error) {
    console.error("Error fetching email config:", error);
    return null;
  }
}

/**
 * Export decryptPassword for use in other modules
 */
export { decryptPassword };

/**
 * Send email using configured SMTP credentials
 */
export async function sendEmail(
  options: SendEmailOptions
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const config = await getEmailConfig();

    if (!config) {
      return {
        success: false,
        error: "Email config not configured",
      };
    }

    // Decrypt the password (or use directly if from env vars)
    const decryptedPassword = config.smtpPasswordEncrypted
      ? decryptPassword(config.smtpPasswordEncrypted, config.smtpPasswordIv)
      : process.env.SMTP_PASSWORD || "";

    if (!decryptedPassword) {
      return {
        success: false,
        error: "No SMTP password available",
      };
    }

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: config.smtpServer,
      port: config.smtpPort,
      secure: config.useSsl, // true for 465, false for other ports
      auth: {
        user: config.smtpUser,
        pass: decryptedPassword,
      },
    });

    // Send email
    const result = await transporter.sendMail({
      from: `${config.fromName || "SmartBC"} <${config.fromEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      replyTo: options.replyTo,
    });

    return {
      success: true,
      messageId: result.messageId,
    };
  } catch (error) {
    console.error("Error sending email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Test SMTP connection
 */
export async function testSmtpConnection(
  config: EmailConfig
): Promise<{ success: boolean; error?: string }> {
  try {
    // Decrypt the password
    const decryptedPassword = decryptPassword(
      config.smtpPasswordEncrypted,
      config.smtpPasswordIv
    );

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: config.smtpServer,
      port: config.smtpPort,
      secure: config.useSsl,
      auth: {
        user: config.smtpUser,
        pass: decryptedPassword,
      },
    });

    // Test connection
    await transporter.verify();

    return { success: true };
  } catch (error) {
    console.error("Error testing SMTP connection:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}
