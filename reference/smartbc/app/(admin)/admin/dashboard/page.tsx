import { TrendingUp, Users, Home, Clock } from "lucide-react";
import { createAdminClient } from "@/lib/db/admin";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageFooter } from "@/components/ui/page-footer";
import { StatCard } from "@/components/ui/stat-card";
import { DashboardActivity, type ActivityItem } from "./dashboard-activity";
import { DashboardQuickLinks } from "./dashboard-quick-links";
import { DashboardTrend } from "./dashboard-trend";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createAdminClient();

  // Fetch all data in parallel
  const [activParticulares, newParticulares7d, totalClients, pendingSolicitudes, recentActivity] = await Promise.all([
    // Total particulares activos
    supabase.from("particulares").select("id", { count: "exact", head: true }).eq("is_active", true),

    // Particulares nuevos en últimos 7 días
    supabase
      .from("particulares")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),

    // Total clientes
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "client"),

    // Solicitudes pendientes este mes
    supabase
      .from("visit_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .gte("requested_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),

    // Actividad reciente (últimas 10)
    getRecentActivity(supabase),
  ]);

  // Fetch last week's count for trend calculation
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { count: particulares7dAgoBefore } = await supabase
    .from("particulares")
    .select("id", { count: "exact", head: true })
    .gte("created_at", twoWeeksAgo)
    .lt("created_at", oneWeekAgo);

  const currentNew = newParticulares7d.count ?? 0;
  const previousNew = particulares7dAgoBefore ?? 0;
  const trend = previousNew > 0 ? Math.round(((currentNew - previousNew) / previousNew) * 100) : 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-6 pb-10 lg:px-10">
      <AdminPageHeader titleKey="dashboard.title" subtitleKey="dashboard.subtitle" />

      {/* Stats Cards */}
      <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Home size={20} strokeWidth={1.75} />}
          labelKey="dashboard.stats.activeListings"
          helpKey="dashboard.stats.help"
          value={activParticulares.count ?? 0}
        />
        <StatCard
          icon={<TrendingUp size={20} strokeWidth={1.75} />}
          labelKey="dashboard.stats.newListings7d"
          helpKey="dashboard.stats.help"
          value={newParticulares7d.count ?? 0}
          footer={trend !== 0 ? <DashboardTrend trend={trend} /> : undefined}
        />
        <StatCard
          icon={<Users size={20} strokeWidth={1.75} />}
          labelKey="dashboard.stats.totalClients"
          helpKey="dashboard.stats.help"
          value={totalClients.count ?? 0}
        />
        <StatCard
          icon={<Clock size={20} strokeWidth={1.75} />}
          labelKey="dashboard.stats.pendingRequests30d"
          helpKey="dashboard.stats.help"
          value={pendingSolicitudes.count ?? 0}
        />
      </div>

      {/* Recent activity + quick links */}
      <div className="mt-8 grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <DashboardActivity activity={recentActivity} className="lg:col-span-2" />
        <DashboardQuickLinks />
      </div>

      <PageFooter textKey="admin.realtime.footer" variant="inline" />
    </div>
  );
}

async function getRecentActivity(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<ActivityItem[]> {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch from 3 sources and combine
  const [particulares, visits, clients] = await Promise.all([
    supabase
      .from("particulares")
      .select("id, portal, external_id, created_at")
      .gte("created_at", oneWeekAgo)
      .order("created_at", { ascending: false })
      .limit(3),

    supabase
      .from("visit_requests")
      .select("id, property_id, requested_at, status")
      .gte("requested_at", oneWeekAgo)
      .order("requested_at", { ascending: false })
      .limit(3),

    supabase
      .from("profiles")
      .select("id, full_name, created_at")
      .eq("role", "client")
      .gte("created_at", oneWeekAgo)
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  const particularRows = (particulares.data ?? []) as unknown as {
    id: string;
    portal: string;
    external_id: string;
    created_at: string;
  }[];
  const visitRows = (visits.data ?? []) as unknown as {
    id: string;
    property_id: string;
    requested_at: string;
    status: string;
  }[];
  const clientRows = (clients.data ?? []) as unknown as {
    id: string;
    full_name: string | null;
    created_at: string;
  }[];

  const activity: ActivityItem[] = [
    ...particularRows.map((p): ActivityItem => ({
      type: "particular",
      portal: p.portal,
      externalId: p.external_id,
      timestamp: p.created_at,
    })),
    ...visitRows.map((v): ActivityItem => ({
      type: "visit",
      status: v.status,
      timestamp: v.requested_at,
    })),
    ...clientRows.map((c): ActivityItem => ({
      type: "client",
      name: c.full_name,
      timestamp: c.created_at,
    })),
  ];

  return activity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 10);
}
