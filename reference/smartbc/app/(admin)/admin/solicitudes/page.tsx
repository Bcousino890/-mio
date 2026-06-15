import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageFooter } from "@/components/ui/page-footer";
import { StatCard } from "@/components/ui/stat-card";
import { visitRequestRowToLegacy } from "@/lib/db/adapters";
import {
  getVisitRequests,
  getVisitRequestsStats,
} from "@/lib/db/queries/clients";
import { SolicitudesAdminClient } from "./solicitudes-admin-client";

export default async function AdminSolicitudesPage() {
  const [rows, stats] = await Promise.all([
    getVisitRequests(),
    getVisitRequestsStats(),
  ]);
  const requests = rows.map(visitRequestRowToLegacy);

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-6 pb-10 lg:px-10">
      <AdminPageHeader
        titleKey="solicitudes.title"
        subtitleKey="solicitudes.subtitle"
      />

      <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<CalendarDays size={20} strokeWidth={1.75} />}
          labelKey="solicitudes.stats.total"
          value={stats.total}
        />
        <StatCard
          icon={<CalendarClock size={20} strokeWidth={1.75} />}
          labelKey="solicitudes.stats.pending"
          value={stats.pending}
        />
        <StatCard
          icon={<CalendarCheck size={20} strokeWidth={1.75} />}
          labelKey="solicitudes.stats.confirmed"
          value={stats.confirmed}
        />
        <StatCard
          icon={<CalendarDays size={20} strokeWidth={1.75} />}
          labelKey="solicitudes.stats.thisWeek"
          value={stats.thisWeek}
        />
      </div>

      <SolicitudesAdminClient requests={requests} />

      <PageFooter textKey="admin.realtime.footer" variant="inline" />
    </div>
  );
}
