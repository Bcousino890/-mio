import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageFooter } from "@/components/ui/page-footer";
import { profileRowToInternalUser, deriveInitials } from "@/lib/db/adapters";
import { getAllProfiles } from "@/lib/db/queries/clients";
import { UsuariosClient } from "./usuarios-client";
import { getCurrentProfile } from "@/lib/db/queries/session";
import type { InternalUserRole } from "@/lib/types";

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  month: "short",
  year: "numeric",
});

// Roles que se mapean con el adaptador de staff; el resto (client, viewer,
// roles desconocidos del enum) pasa por el mapeo manual de abajo. Así NINGÚN
// perfil de la BD queda fuera del listado.
const STAFF_ROLES = [
  "owner", "admin", "advisor", "agent_junior", "agent_senior", "agent_admin",
];

export default async function AdminUsuariosPage() {
  const [profileRows, currentUser] = await Promise.all([
    getAllProfiles().catch((e) => { console.error("getAllProfiles error:", e); return []; }),
    getCurrentProfile().catch(() => null),
  ]);

  const staffRows = profileRows.filter((row) => STAFF_ROLES.includes(row.role ?? ""));
  const otherRows = profileRows.filter((row) => !STAFF_ROLES.includes(row.role ?? ""));

  const staffUsers = staffRows.map(profileRowToInternalUser);
  const otherUsers = otherRows.map((row) => ({
    id: row.id,
    firstName: row.full_name?.split(" ")[0] ?? "",
    lastName: row.full_name?.split(" ").slice(1).join(" ") ?? "",
    email: row.email ?? "",
    initials: deriveInitials(row.full_name || row.email || "?"),
    // Rol real para "client"; cualquier otro valor (viewer, roles raros o
    // futuros) se muestra como "viewer" para no romper el tipado.
    roleKey: (row.role === "client" ? "client" : "viewer") as InternalUserRole,
    status: "active" as const,
    joinedLabel: DATE_FORMATTER.format(new Date(row.created_at)),
  }));

  const allUsers = [...staffUsers, ...otherUsers];
  const validRoles: InternalUserRole[] = [
    "owner", "admin", "advisor", "client", "viewer",
    "agent_junior", "agent_senior", "agent_admin",
  ];
  const currentUserRole: InternalUserRole = validRoles.includes(
    currentUser?.role as InternalUserRole
  )
    ? (currentUser!.role as InternalUserRole)
    : "viewer";

  return (
    <div className="mx-auto flex min-h-screen max-w-[1200px] flex-col px-6 pb-10 lg:px-10">
      <AdminPageHeader
        titleKey="usuarios.title"
        subtitleKey="usuarios.subtitle"
      />

      <UsuariosClient users={allUsers} currentUserRole={currentUserRole} />

      <PageFooter textKey="admin.realtime.footer" variant="inline" />
    </div>
  );
}
