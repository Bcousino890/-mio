/**
 * Sistema de permisos para roles de agentes inmobiliarios.
 *
 * Modelo canónico (ÚNICO) usado por:
 *   - canAccess() y las matrices PERMISSIONS_BY_ROLE de este archivo
 *   - app/api/admin/usuarios/[id]/permissions/route.ts (RESOURCES / ACTIONS)
 *   - La UI de gestión de permisos (components/admin/permissions/**)
 *
 * Recursos: properties | particulares | clientes | solicitudes | mensajes |
 *           reportes | usuarios | configuracion | calendario
 * Acciones: view | create | edit | delete | export
 */

export type PermissionResource =
  | "properties"
  | "particulares"
  | "clientes"
  | "solicitudes"
  | "mensajes"
  | "reportes"
  | "usuarios"
  | "configuracion"
  | "calendario";

export type PermissionAction = "view" | "create" | "edit" | "delete" | "export";

type PermissionMatrix = Record<PermissionResource, Record<PermissionAction, boolean>>;

// ─── Orden canónico (para iterar de forma estable en API y UI) ────────────────

export const PERMISSION_RESOURCES: readonly PermissionResource[] = [
  "properties",
  "particulares",
  "clientes",
  "solicitudes",
  "mensajes",
  "reportes",
  "usuarios",
  "configuracion",
  "calendario",
] as const;

export const PERMISSION_ACTIONS: readonly PermissionAction[] = [
  "view",
  "create",
  "edit",
  "delete",
  "export",
] as const;

// ─── Etiquetas y descripciones en español (para la UI) ────────────────────────

export const RESOURCE_LABELS: Record<PermissionResource, string> = {
  properties:    "Propiedades",
  particulares:  "Particulares",
  clientes:      "Clientes",
  solicitudes:   "Solicitudes y visitas",
  mensajes:      "Mensajes",
  reportes:      "Reportes",
  usuarios:      "Usuarios",
  configuracion: "Configuración",
  calendario:    "Calendario",
};

export const RESOURCE_DESCRIPTIONS: Record<PermissionResource, string> = {
  properties:    "Cartera de propiedades de la agencia.",
  particulares:  "Captaciones y anuncios de particulares.",
  clientes:      "Base de datos de clientes y leads.",
  solicitudes:   "Solicitudes de información y visitas.",
  mensajes:      "Bandeja de mensajes y conversaciones.",
  reportes:      "Informes y métricas del negocio.",
  usuarios:      "Equipo interno y gestión de cuentas.",
  configuracion: "Ajustes generales de la cuenta.",
  calendario:    "Agenda, citas y eventos.",
};

export const ACTION_LABELS: Record<PermissionAction, string> = {
  view:   "Ver",
  create: "Crear",
  edit:   "Editar",
  delete: "Eliminar",
  export: "Exportar",
};

export const ACTION_DESCRIPTIONS: Record<PermissionAction, string> = {
  view:   "Consultar y acceder a los registros.",
  create: "Añadir nuevos registros.",
  edit:   "Modificar registros existentes.",
  delete: "Eliminar registros de forma permanente.",
  export: "Descargar o exportar los datos.",
};

// ─── Matrices por rol ─────────────────────────────────────────────────────────

const AGENT_JUNIOR_PERMISSIONS: PermissionMatrix = {
  properties:    { view: true,  create: false, edit: false, delete: false, export: false },
  particulares:  { view: true,  create: false, edit: false, delete: false, export: false },
  clientes:      { view: true,  create: false, edit: false, delete: false, export: false },
  solicitudes:   { view: true,  create: false, edit: false, delete: false, export: false },
  mensajes:      { view: true,  create: false, edit: false, delete: false, export: false },
  reportes:      { view: false, create: false, edit: false, delete: false, export: false },
  usuarios:      { view: false, create: false, edit: false, delete: false, export: false },
  configuracion: { view: false, create: false, edit: false, delete: false, export: false },
  calendario:    { view: true,  create: false, edit: false, delete: false, export: false },
};

const AGENT_SENIOR_PERMISSIONS: PermissionMatrix = {
  properties:    { view: true,  create: true,  edit: true,  delete: false, export: true  },
  particulares:  { view: true,  create: true,  edit: true,  delete: false, export: false },
  clientes:      { view: true,  create: true,  edit: true,  delete: false, export: false },
  solicitudes:   { view: true,  create: true,  edit: true,  delete: false, export: false },
  mensajes:      { view: true,  create: true,  edit: false, delete: false, export: false },
  reportes:      { view: true,  create: false, edit: false, delete: false, export: false },
  usuarios:      { view: false, create: false, edit: false, delete: false, export: false },
  configuracion: { view: false, create: false, edit: false, delete: false, export: false },
  calendario:    { view: true,  create: true,  edit: true,  delete: false, export: false },
};

const AGENT_ADMIN_PERMISSIONS: PermissionMatrix = {
  properties:    { view: true, create: true,  edit: true, delete: true,  export: true  },
  particulares:  { view: true, create: true,  edit: true, delete: true,  export: true  },
  clientes:      { view: true, create: true,  edit: true, delete: true,  export: true  },
  solicitudes:   { view: true, create: true,  edit: true, delete: true,  export: true  },
  mensajes:      { view: true, create: true,  edit: true, delete: false, export: false },
  reportes:      { view: true, create: false, edit: false, delete: false, export: true  },
  usuarios:      { view: true, create: true,  edit: true, delete: false, export: false },
  configuracion: { view: true, create: false, edit: true, delete: false, export: false },
  calendario:    { view: true, create: true,  edit: true, delete: true,  export: false },
};

// Roles con acceso total (owner, admin) — todo permitido
const FULL_ACCESS_PERMISSIONS: PermissionMatrix = {
  properties:    { view: true, create: true, edit: true, delete: true, export: true },
  particulares:  { view: true, create: true, edit: true, delete: true, export: true },
  clientes:      { view: true, create: true, edit: true, delete: true, export: true },
  solicitudes:   { view: true, create: true, edit: true, delete: true, export: true },
  mensajes:      { view: true, create: true, edit: true, delete: true, export: true },
  reportes:      { view: true, create: true, edit: true, delete: true, export: true },
  usuarios:      { view: true, create: true, edit: true, delete: true, export: true },
  configuracion: { view: true, create: true, edit: true, delete: true, export: true },
  calendario:    { view: true, create: true, edit: true, delete: true, export: true },
};

// Advisor: similar a full access pero sin gestión total de usuarios/config
const ADVISOR_PERMISSIONS: PermissionMatrix = {
  properties:    { view: true, create: true,  edit: true,  delete: true,  export: true  },
  particulares:  { view: true, create: true,  edit: true,  delete: true,  export: true  },
  clientes:      { view: true, create: true,  edit: true,  delete: true,  export: true  },
  solicitudes:   { view: true, create: true,  edit: true,  delete: true,  export: true  },
  mensajes:      { view: true, create: true,  edit: true,  delete: false, export: false },
  reportes:      { view: true, create: false, edit: false, delete: false, export: true  },
  usuarios:      { view: true, create: false, edit: false, delete: false, export: false },
  configuracion: { view: true, create: false, edit: true,  delete: false, export: false },
  calendario:    { view: true, create: true,  edit: true,  delete: true,  export: false },
};

// Sin acceso (client, viewer, roles desconocidos)
const NO_ACCESS_PERMISSIONS: PermissionMatrix = {
  properties:    { view: false, create: false, edit: false, delete: false, export: false },
  particulares:  { view: false, create: false, edit: false, delete: false, export: false },
  clientes:      { view: false, create: false, edit: false, delete: false, export: false },
  solicitudes:   { view: false, create: false, edit: false, delete: false, export: false },
  mensajes:      { view: false, create: false, edit: false, delete: false, export: false },
  reportes:      { view: false, create: false, edit: false, delete: false, export: false },
  usuarios:      { view: false, create: false, edit: false, delete: false, export: false },
  configuracion: { view: false, create: false, edit: false, delete: false, export: false },
  calendario:    { view: false, create: false, edit: false, delete: false, export: false },
};

// ─── Mapa de permisos por rol ─────────────────────────────────────────────────

export const PERMISSIONS_BY_ROLE: Record<string, PermissionMatrix> = {
  owner:         FULL_ACCESS_PERMISSIONS,
  admin:         FULL_ACCESS_PERMISSIONS,
  advisor:       ADVISOR_PERMISSIONS,
  agent_admin:   AGENT_ADMIN_PERMISSIONS,
  agent_senior:  AGENT_SENIOR_PERMISSIONS,
  agent_junior:  AGENT_JUNIOR_PERMISSIONS,
  client:        NO_ACCESS_PERMISSIONS,
  viewer:        NO_ACCESS_PERMISSIONS,
};

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Verifica si un rol tiene permiso para realizar una acción sobre un recurso.
 *
 * @param role     - Rol del usuario (ej. "agent_junior", "admin")
 * @param resource - Recurso (ej. "particulares", "properties")
 * @param action   - Acción (ej. "view", "edit", "delete")
 * @returns        true si el acceso está permitido, false en caso contrario
 */
export function canAccess(
  role: string,
  resource: string,
  action: string,
): boolean {
  const matrix = PERMISSIONS_BY_ROLE[role] ?? NO_ACCESS_PERMISSIONS;
  const resourcePerms = matrix[resource as PermissionResource];
  if (!resourcePerms) return false;
  return resourcePerms[action as PermissionAction] ?? false;
}

// ─── Permisos efectivos (rol + excepciones por usuario) ──────────────────────

export type PermissionOverride = {
  resource: string;
  action: string;
  allowed: boolean;
};

export type EffectivePermissions = Record<
  PermissionResource,
  Record<PermissionAction, boolean>
>;

/**
 * Combina la matriz del rol con las excepciones por usuario guardadas en
 * `user_permission_overrides`. Una excepción siempre gana sobre el default
 * del rol (tanto para conceder como para denegar).
 */
export function applyOverrides(
  role: string,
  overrides: PermissionOverride[],
): EffectivePermissions {
  const matrix = PERMISSIONS_BY_ROLE[role] ?? NO_ACCESS_PERMISSIONS;
  const effective = {} as EffectivePermissions;
  for (const resource of PERMISSION_RESOURCES) {
    effective[resource] = { ...matrix[resource] };
  }
  for (const o of overrides) {
    const res = o.resource as PermissionResource;
    const act = o.action as PermissionAction;
    if (effective[res] && act in effective[res]) {
      effective[res][act] = o.allowed;
    }
  }
  return effective;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Roles de agente inmobiliario (los 3 nuevos) */
export const AGENT_ROLES = ["agent_junior", "agent_senior", "agent_admin"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** Todos los roles staff que acceden a /admin */
export const STAFF_ROLES = [
  "owner",
  "admin",
  "advisor",
  "agent_junior",
  "agent_senior",
  "agent_admin",
] as const;

/** Comprueba si un rol es un rol de agente inmobiliario */
export function isAgentRole(role: string): role is AgentRole {
  return AGENT_ROLES.includes(role as AgentRole);
}

/** Comprueba si un rol es staff (accede al /admin) */
export function isStaffRole(role: string): boolean {
  return STAFF_ROLES.includes(role as (typeof STAFF_ROLES)[number]);
}
