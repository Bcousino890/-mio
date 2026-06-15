import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { getCurrentProfile } from "@/lib/db/queries/session";
import {
  canAccess,
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
} from "@/lib/permissions";

// Resources and actions shown in the permissions matrix.
// Canonical set lives in lib/permissions.ts so canAccess() resolves every cell.
const RESOURCES = PERMISSION_RESOURCES;
const ACTIONS = PERMISSION_ACTIONS;

type PermValue = true | false | "override_true" | "override_false";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: userId } = await params;

  const currentProfile = await getCurrentProfile();
  if (!currentProfile) {
    return Response.json({ error: "No autenticado" }, { status: 401 });
  }

  const callerRole = currentProfile.role as string;
  if (
    callerRole !== "admin" &&
    callerRole !== "owner" &&
    currentProfile.id !== userId
  ) {
    return Response.json({ error: "Sin acceso" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;

  // Fetch target user's role
  const { data: profile, error: profileErr } = await db
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (profileErr || !profile) {
    return Response.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  const role: string = profile.role;

  // Fetch per-user overrides
  const { data: overrides, error: overridesErr } = await db
    .from("user_permission_overrides")
    .select("resource, action, allowed")
    .eq("user_id", userId);

  if (overridesErr) {
    return Response.json({ error: overridesErr.message }, { status: 500 });
  }

  // Build override lookup: { resource: { action: boolean } }
  const overrideMap: Record<string, Record<string, boolean>> = {};
  for (const row of overrides ?? []) {
    if (!overrideMap[row.resource]) overrideMap[row.resource] = {};
    overrideMap[row.resource][row.action] = row.allowed;
  }

  // Build merged permissions matrix
  const permissions: Record<string, Record<string, PermValue>> = {};
  for (const resource of RESOURCES) {
    permissions[resource] = {};
    for (const action of ACTIONS) {
      const roleDefault = canAccess(role, resource, action);
      const hasOverride =
        overrideMap[resource] !== undefined &&
        overrideMap[resource][action] !== undefined;

      if (hasOverride) {
        const overrideAllowed = overrideMap[resource][action];
        permissions[resource][action] = overrideAllowed
          ? "override_true"
          : "override_false";
      } else {
        permissions[resource][action] = roleDefault;
      }
    }
  }

  return Response.json({ role, permissions });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: userId } = await params;

  const currentProfile = await getCurrentProfile();
  if (!currentProfile) {
    return Response.json({ error: "No autenticado" }, { status: 401 });
  }

  const callerRole = currentProfile.role as string;
  if (!["owner", "admin", "agent_admin"].includes(callerRole)) {
    return Response.json(
      { error: "Solo admins pueden modificar permisos" },
      { status: 403 },
    );
  }

  let body: { overrides: { resource: string; action: string; allowed: boolean }[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!Array.isArray(body.overrides)) {
    return Response.json({ error: "overrides debe ser un array" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;

  // Delete all existing overrides for this user
  const { error: deleteErr } = await db
    .from("user_permission_overrides")
    .delete()
    .eq("user_id", userId);

  if (deleteErr) {
    return Response.json({ error: deleteErr.message }, { status: 500 });
  }

  // Insert new overrides (if any)
  if (body.overrides.length > 0) {
    const rows = body.overrides.map((o) => ({
      user_id: userId,
      resource: o.resource,
      action: o.action,
      allowed: o.allowed,
      created_by: currentProfile.id,
    }));

    const { error: insertErr } = await db
      .from("user_permission_overrides")
      .insert(rows);

    if (insertErr) {
      return Response.json({ error: insertErr.message }, { status: 500 });
    }
  }

  return Response.json({ ok: true });
}
