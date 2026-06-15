import "server-only";
import { createClient } from "@/lib/db/server";
import { createAdminClient } from "@/lib/db/admin";
import { getCurrentProfile } from "@/lib/db/queries/session";

/**
 * Endpoint de diagnóstico para depurar por qué no aparecen usuarios.
 * Solo lectura. NO expone valores de claves, solo si están presentes.
 * GET /api/admin/debug/users
 */
export async function GET() {
  // Gate: solo owner/admin autenticado. getCurrentProfile() lee el propio
  // perfil vía RLS (profiles_self_select), así que funciona aunque is_staff()
  // todavía no reconozca el rol (el caso que estamos diagnosticando).
  const gateProfile = await getCurrentProfile().catch(() => null);
  if (!gateProfile || !["owner", "admin"].includes(gateProfile.role)) {
    return Response.json(
      { error: "No autorizado — solo Owner/Admin" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
  };

  // 1. Variables de entorno (solo presencia, nunca el valor)
  result.env = {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL_value: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ANON_KEY_length: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.length ?? 0,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    SERVICE_ROLE_KEY_length: process.env.SUPABASE_SERVICE_ROLE_KEY?.length ?? 0,
  };

  // 2. Usuario actual y su rol
  let currentProfile: { id: string; role: string; email: string } | null = null;
  try {
    const p = await getCurrentProfile();
    currentProfile = p
      ? { id: p.id, role: p.role, email: p.email }
      : null;
    result.currentProfile = currentProfile;
  } catch (e) {
    result.currentProfileError = e instanceof Error ? e.message : String(e);
  }

  // 3. Query con cliente de SESIÓN (respeta RLS)
  try {
    const session = await createClient();
    const { data, error } = await session
      .from("profiles")
      .select("id, role, email, full_name")
      .order("created_at", { ascending: false })
      .limit(500);
    result.sessionClient = {
      ok: !error,
      error: error?.message ?? null,
      count: data?.length ?? 0,
      byRole: countByRole(data),
    };
  } catch (e) {
    result.sessionClient = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // 4. Query con cliente ADMIN (service role, bypassa RLS)
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("id, role, email, full_name")
      .order("created_at", { ascending: false })
      .limit(500);
    result.adminClient = {
      ok: !error,
      error: error?.message ?? null,
      count: data?.length ?? 0,
      byRole: countByRole(data),
    };
  } catch (e) {
    result.adminClient = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // 5. ¿is_staff() / is_admin() devuelven true para el usuario actual?
  try {
    const session = await createClient();
    const [{ data: staff, error: staffErr }, { data: admin, error: adminErr }] =
      await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session as any).rpc("is_staff"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session as any).rpc("is_admin"),
      ]);
    result.rlsHelpers = {
      is_staff: staff ?? null,
      is_staff_error: staffErr?.message ?? null,
      is_admin: admin ?? null,
      is_admin_error: adminErr?.message ?? null,
    };
  } catch (e) {
    result.rlsHelpers = { error: e instanceof Error ? e.message : String(e) };
  }

  return Response.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}

function countByRole(
  data: Array<{ role: string }> | null,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.role] = (counts[row.role] ?? 0) + 1;
  }
  return counts;
}
