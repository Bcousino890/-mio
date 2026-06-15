import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { createPasswordResetToken, sendPasswordResetEmail } from "@/lib/email/password-reset";

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return Response.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createAdminClient() as any;

    // Step 1: Try to find user in profiles table
    let userId: string | null = null;
    let userName: string = "Usuario";
    let userEmail: string = normalizedEmail;

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("id, full_name, email")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (profileError) {
      console.log("[forgot-password] Error querying profiles:", profileError);
    }

    if (profile) {
      userId = profile.id;
      userName = profile.full_name || "Usuario";
      userEmail = profile.email || normalizedEmail;
      console.log("[forgot-password] Found user in profiles:", userId);
    } else {
      // Step 2: Fallback — search directly in auth.users via admin API
      console.log("[forgot-password] User not found in profiles, falling back to auth.users for email:", normalizedEmail);
      try {
        const { data: authData, error: authError } = await db.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });

        if (authError) {
          console.log("[forgot-password] Error listing auth.users:", authError);
        } else if (authData?.users) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const authUser = authData.users.find(
            (u: any) => u.email?.toLowerCase() === normalizedEmail
          );
          if (authUser) {
            userId = authUser.id;
            userEmail = authUser.email || normalizedEmail;
            // Try to get full_name from profiles by id
            const { data: profileById } = await db
              .from("profiles")
              .select("full_name")
              .eq("id", authUser.id)
              .maybeSingle();
            userName = profileById?.full_name || "Usuario";
            console.log("[forgot-password] Found user in auth.users:", userId);
          } else {
            console.log("[forgot-password] User not found in auth.users either for email:", normalizedEmail);
          }
        }
      } catch (authLookupError) {
        console.log("[forgot-password] Exception in auth.users lookup:", authLookupError);
      }
    }

    if (!userId) {
      // Don't reveal whether the email exists (security)
      return Response.json(
        { ok: true, message: "If the email exists, you will receive a password reset link" },
        { status: 200 }
      );
    }

    // Create reset token
    const tokenData = await createPasswordResetToken(userId, 24);

    if (!tokenData) {
      console.log("[forgot-password] Failed to create reset token for userId:", userId);
      return Response.json(
        { error: "Error creating reset token" },
        { status: 500 }
      );
    }

    console.log("[forgot-password] Token created, expires at:", tokenData.expiresAt);

    // Build reset URL — use NEXT_PUBLIC_PORTAL_URL (the public domain) or fallback to APP_URL
    const appUrl = process.env.NEXT_PUBLIC_PORTAL_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3137";
    const resetUrl = `${appUrl}/auth/reset-password?token=${tokenData.token}`;

    console.log("[forgot-password] Sending email to:", userEmail, "| reset URL base:", appUrl);

    // Send email
    const emailResult = await sendPasswordResetEmail(
      userEmail,
      userName,
      resetUrl
    );

    if (!emailResult.success) {
      console.log("[forgot-password] Failed to send password reset email:", emailResult.error);
      // Don't expose email service errors to client
      return Response.json(
        { ok: true, message: "If the email exists, you will receive a password reset link" },
        { status: 200 }
      );
    }

    console.log("[forgot-password] Email sent successfully to:", userEmail);

    return Response.json(
      { ok: true, message: "If the email exists, you will receive a password reset link" },
      { status: 200 }
    );
  } catch (error) {
    console.log("[forgot-password] Unhandled error:", error);
    return Response.json(
      { error: "Error processing password reset request" },
      { status: 500 }
    );
  }
}
