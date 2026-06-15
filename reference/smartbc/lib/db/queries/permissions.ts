import "server-only";
import { createAdminClient } from "../admin";
import {
  applyOverrides,
  type EffectivePermissions,
  type PermissionOverride,
} from "@/lib/permissions";

/**
 * Permisos efectivos de un usuario: matriz del rol + excepciones guardadas
 * en `user_permission_overrides`. Si la tabla no existe aún (migración 0029
 * pendiente en el VPS) cae sin romper a los defaults del rol.
 */
export async function getEffectivePermissions(
  userId: string,
  role: string,
): Promise<EffectivePermissions> {
  let overrides: PermissionOverride[] = [];
  try {
    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any)
      .from("user_permission_overrides")
      .select("resource, action, allowed")
      .eq("user_id", userId);
    if (!error && data) overrides = data as PermissionOverride[];
  } catch {
    // Sin overrides: solo defaults del rol.
  }
  return applyOverrides(role, overrides);
}
