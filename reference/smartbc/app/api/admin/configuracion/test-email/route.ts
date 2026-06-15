import "server-only";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodemailer = require('nodemailer');
import { renderEmailLayout, escapeHtml } from "@/lib/email/templates";

export async function POST(req: Request) {
  try {
    const { smtpServer, smtpPort, smtpUser, smtpPassword, useSsl, fromEmail, fromName } =
      await req.json();

    // Validation
    if (!smtpServer || !smtpPort || !smtpUser || !smtpPassword || !fromEmail) {
      return Response.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Generate a temporary IV for the test (IV is just for testing, not stored)
    const tempIv = "test-encryption-key";

    // For testing, we pass the plaintext password directly
    try {
      const transporter = nodemailer.createTransport({
        host: smtpServer,
        port: smtpPort,
        secure: useSsl ?? true,
        auth: {
          user: smtpUser,
          pass: smtpPassword,
        },
      });

      await transporter.verify();

      // If connection successful, send a test email
      const testEmailResult = await transporter.sendMail({
        from: `${fromName || "SmartBC"} <${fromEmail}>`,
        to: fromEmail, // Send test email to the configured from_email
        subject: "Prueba de conexión SMTP - Benjamín Cousiño Propiedades",
        html: renderEmailLayout({
          title: "Conexión SMTP verificada",
          bodyHtml: `
            <p style="margin: 0 0 14px 0;">Tu configuraci&oacute;n de correo SMTP est&aacute; funcionando correctamente.</p>
            <p style="margin: 0 0 6px 0;"><strong>Remitente:</strong> ${escapeHtml(String(fromEmail))}</p>
            <p style="margin: 0 0 6px 0;"><strong>Servidor:</strong> ${escapeHtml(String(smtpServer))}:${escapeHtml(String(smtpPort))}</p>
            <p style="margin: 0 0 14px 0;"><strong>SSL/TLS:</strong> ${useSsl ? "Habilitado" : "Deshabilitado"}</p>
            <p style="margin: 0;">Este es un correo de prueba. Si lo recibes, tu configuraci&oacute;n est&aacute; correcta.</p>
          `,
        }),
      });

      return Response.json({
        ok: true,
        message: "SMTP connection successful and test email sent",
        messageId: testEmailResult.messageId,
      });
    } catch (connectionError) {
      console.error("SMTP connection test error:", connectionError);
      return Response.json(
        {
          ok: false,
          error: `SMTP connection failed: ${
            connectionError instanceof Error ? connectionError.message : "Unknown error"
          }`,
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Test email error:", error);
    return Response.json(
      { error: "Error testing email connection" },
      { status: 500 }
    );
  }
}
