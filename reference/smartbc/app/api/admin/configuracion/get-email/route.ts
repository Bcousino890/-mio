import "server-only";
import { createAdminClient } from "@/lib/db/admin";

export async function GET() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any;

    const { data, error } = await db
      .from("email_config")
      .select(
        "smtp_server, smtp_port, smtp_user, use_ssl, from_email, from_name"
      )
      .limit(1)
      .single();

    if (error || !data) {
      return Response.json(
        { config: null },
        { status: 200 }
      );
    }

    // Don't return the encrypted password
    return Response.json(
      {
        config: {
          smtpServer: data.smtp_server,
          smtpPort: data.smtp_port,
          smtpUser: data.smtp_user,
          useSsl: data.use_ssl,
          fromEmail: data.from_email,
          fromName: data.from_name,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Get email config error:", error);
    return Response.json(
      { error: "Error fetching email configuration" },
      { status: 500 }
    );
  }
}
