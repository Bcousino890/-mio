import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { verifyResetToken, markTokenAsUsed } from "@/lib/email/password-reset";

export async function POST(req: Request) {
  try {
    const { token, password } = await req.json();

    if (!token || !password) {
      return Response.json(
        { error: "Token and password are required" },
        { status: 400 }
      );
    }

    // Verify the token
    console.log("[reset-password] Verifying token...");
    const userId = await verifyResetToken(token);

    if (!userId) {
      console.log("[reset-password] Invalid or expired token");
      return Response.json(
        { error: "Invalid or expired reset token" },
        { status: 400 }
      );
    }

    console.log("[reset-password] Token valid for userId:", userId);

    // Use the shared admin client (service role) to update auth user password
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createAdminClient() as any;

    // Update the auth user password
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      userId,
      { password }
    );

    if (updateError) {
      console.log("[reset-password] Error updating password:", updateError);
      return Response.json(
        { error: "Error updating password" },
        { status: 500 }
      );
    }

    console.log("[reset-password] Password updated successfully for userId:", userId);

    // Mark token as used
    const marked = await markTokenAsUsed(token);
    if (!marked) {
      console.log("[reset-password] Warning: could not mark token as used");
    }

    return Response.json(
      { ok: true, message: "Password reset successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.log("[reset-password] Unhandled error:", error);
    return Response.json(
      { error: "Error resetting password" },
      { status: 500 }
    );
  }
}
