import "server-only";
import { createAdminClient } from "../admin";

export type ReportsStatsData = {
  totalProperties: number;
  totalClients: number;
  visitsThisMonth: number;
  totalSmartLinkOpens: number;
  byZone: Array<[string, number]>;
  byOperation: Record<string, number>;
};

export async function getReportsStats(): Promise<ReportsStatsData> {
  const supabase = createAdminClient();

  const now = new Date();
  const startOfMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
  ).toISOString();

  const [properties, clients, visits, links, byZone, byOperation] =
    await Promise.all([
      supabase
        .from("properties")
        .select("*", { count: "exact", head: true })
        .is("archived_at", null),
      supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("role", "client"),
      supabase
        .from("visit_requests")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startOfMonth),
      supabase.from("property_shares").select("opens_count"),
      supabase
        .from("properties")
        .select("zone")
        .is("archived_at", null)
        .not("zone", "is", null),
      supabase
        .from("properties")
        .select("operation")
        .is("archived_at", null)
        .not("operation", "is", null),
    ]);

  const totalOpens = (
    (links.data ?? []) as Array<{ opens_count: number | null }>
  ).reduce((acc, r) => acc + (r.opens_count ?? 0), 0);

  // Agrupar por zona
  const zoneMap: Record<string, number> = {};
  for (const p of (byZone.data ?? []) as Array<{ zone: string | null }>) {
    if (!p.zone) continue;
    zoneMap[p.zone] = (zoneMap[p.zone] ?? 0) + 1;
  }
  const zoneData = Object.entries(zoneMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8) as Array<[string, number]>;

  // Agrupar por operación
  const opMap: Record<string, number> = {};
  for (const p of (byOperation.data ?? []) as Array<{
    operation: string | null;
  }>) {
    if (!p.operation) continue;
    opMap[p.operation] = (opMap[p.operation] ?? 0) + 1;
  }

  return {
    totalProperties: properties.count ?? 0,
    totalClients: clients.count ?? 0,
    visitsThisMonth: visits.count ?? 0,
    totalSmartLinkOpens: totalOpens,
    byZone: zoneData,
    byOperation: opMap,
  };
}
