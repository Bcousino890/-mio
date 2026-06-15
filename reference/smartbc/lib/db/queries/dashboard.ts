import "server-only";
import { createAdminClient } from "../admin";

export async function getDashboardData() {
  const db = createAdminClient() as any;

  const [props, clients, visits, shares, recentProps, recentVisits] =
    await Promise.all([
      db
        .from("properties")
        .select("*", { count: "exact", head: true })
        .is("archived_at", null)
        .eq("status", "available"),
      db
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("role", "client"),
      db
        .from("visit_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      db
        .from("property_shares")
        .select("*", { count: "exact", head: true }),
      db
        .from("properties")
        .select(
          "id,slug,title,zone,price,operation,status,bc_reference,cover_photo_url"
        )
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(5),
      db
        .from("visit_requests")
        .select(
          "id,created_at,status,profiles!visit_requests_client_id_fkey(full_name,email),properties(title,bc_reference)"
        )
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  return {
    kpis: {
      activeProperties: props.count ?? 0,
      totalClients: clients.count ?? 0,
      pendingVisits: visits.count ?? 0,
      smartLinks: shares.count ?? 0,
    },
    recentProperties: (recentProps.data ?? []) as Array<{
      id: string;
      slug: string;
      title: string;
      zone: string | null;
      price: number | null;
      operation: string | null;
      status: string | null;
      bc_reference: string | null;
      cover_photo_url: string | null;
    }>,
    recentVisits: (recentVisits.data ?? []) as Array<{
      id: string;
      created_at: string;
      status: string;
      profiles: { full_name: string | null; email: string | null } | null;
      properties: { title: string | null; bc_reference: string | null } | null;
    }>,
  };
}
