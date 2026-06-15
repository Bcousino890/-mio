"use client";

import { useCallback } from "react";
import { canAccess, type PermissionAction, type PermissionResource } from "@/lib/permissions";

/**
 * Hook de permisos client-side.
 *
 * Uso:
 *   const { can } = usePermissions("agent_junior");
 *   if (can("particulares", "delete")) { ... }
 *
 * El rol se pasa como parámetro (normalmente viene del contexto de sesión).
 * Si no se pasa, se asume que el usuario no tiene acceso.
 */
export function usePermissions(role?: string | null) {
  const can = useCallback(
    (resource: PermissionResource, action: PermissionAction): boolean => {
      if (!role) return false;
      return canAccess(role, resource, action);
    },
    [role],
  );

  return { can };
}
