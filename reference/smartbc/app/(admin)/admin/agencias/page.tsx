import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AgenciesStatsBlock } from "@/components/admin/agencies-stats";
import { AgenciesTable } from "@/components/admin/agencies-table";
import { NewAgencyButton } from "@/components/admin/new-agency-button";
import { PageFooter } from "@/components/ui/page-footer";
import { agencyRowToLegacy } from "@/lib/db/adapters";
import { getAgenciesWithStats } from "@/lib/db/queries/agencies";
import { getAgenciesStats } from "@/lib/mock-agencies";

export default async function AdminAgenciasPage() {
  const rows = await getAgenciesWithStats();
  const agencies = rows.map(agencyRowToLegacy);
  const stats = getAgenciesStats(agencies);

  return (
    <div className="mx-auto flex min-h-screen max-w-[1200px] flex-col px-6 pb-10 lg:px-10">
      <AdminPageHeader
        titleKey="agencias.title"
        subtitleKey="agencias.subtitle"
      />

      <div className="mt-7">
        <AgenciesStatsBlock stats={stats} />
      </div>

      <div className="mt-5 flex items-center justify-end">
        <NewAgencyButton />
      </div>

      <div className="mt-3">
        <AgenciesTable agencies={agencies} />
      </div>

      <PageFooter textKey="admin.realtime.footer" variant="inline" />
    </div>
  );
}
