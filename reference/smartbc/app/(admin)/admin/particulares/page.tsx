import { UserSearch, Home, Tag, Clock } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageFooter } from "@/components/ui/page-footer";
import { StatCard } from "@/components/ui/stat-card";
import {
  getParticularesPage,
  getStaffOptions,
} from "@/lib/db/queries/particulares";
import { getCurrentProfile } from "@/lib/db/queries/session";
import { ParticularesClient, type ParticularRow } from "./particulares-client";

export const dynamic = "force-dynamic";

export default async function AdminParticularesPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const currentProfile = await getCurrentProfile();
  await searchParams; // offset ya no se usa: se cargan TODOS los anuncios.
  const pageSize = 100;
  const offset = 0;

  const [{ rows: enrichedRows, total }, staffOptions] = await Promise.all([
    getParticularesPage(),
    getStaffOptions().catch(() => []),
  ]);

  const rows = enrichedRows as unknown as ParticularRow[];
  // Sin paginación: el servidor ya devuelve activos + retirados completos.
  const hasMore = false;

  // Las stats de cabecera se calculan solo sobre ACTIVOS: `rows` incluye
  // los retirados al final (para el tab "Retirados") y no deben inflarlas.
  const activeRows = rows.filter((r) => r.is_active);

  const stats = {
    total: activeRows.length,
    rent: activeRows.filter((r) => r.operation === "rent").length,
    sale: activeRows.filter((r) => r.operation === "sale").length,
    last24h: activeRows.filter(
      (r) =>
        r.created_at &&
        Date.now() - new Date(r.created_at).getTime() < 24 * 60 * 60 * 1000,
    ).length,
  };

  const portalCounts = activeRows.reduce((acc, r) => {
    acc[r.portal] = (acc[r.portal] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-6 pb-10 lg:px-10">
      <AdminPageHeader
        titleKey="adminParticulares.title"
        subtitleKey="adminParticulares.subtitle"
      />

      <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<UserSearch size={20} strokeWidth={1.75} />}
          labelKey="adminParticulares.stats.total"
          helpKey="adminParticulares.stats.help"
          value={stats.total}
          footer={
            Object.keys(portalCounts).length > 0 ? (
              <p className="text-[11px] text-ink/50">
                {Object.entries(portalCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([portal, count]) => `${portal}: ${count}`)
                  .join(" · ")}
              </p>
            ) : undefined
          }
        />
        <StatCard
          icon={<Home size={20} strokeWidth={1.75} />}
          labelKey="adminParticulares.stats.rent"
          helpKey="adminParticulares.stats.help"
          value={stats.rent}
        />
        <StatCard
          icon={<Tag size={19} strokeWidth={1.75} />}
          labelKey="adminParticulares.stats.sale"
          helpKey="adminParticulares.stats.help"
          value={stats.sale}
        />
        <StatCard
          icon={<Clock size={19} strokeWidth={1.75} />}
          labelKey="adminParticulares.stats.last24h"
          helpKey="adminParticulares.stats.help"
          value={stats.last24h}
        />
      </div>

      <ParticularesClient
        rows={rows}
        currentRole={currentProfile?.role}
        currentUserId={currentProfile?.id}
        staffOptions={staffOptions}
        hasMore={hasMore}
        currentOffset={offset}
        pageSize={pageSize}
        total={total}
      />

      <PageFooter textKey="admin.realtime.footer" variant="inline" />
    </div>
  );
}
