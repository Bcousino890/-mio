import { createAdminClient } from "@/lib/db/admin";
import { createClient } from "@/lib/db/server";
import { CalendarioClient } from "./calendario-client";

export const dynamic = "force-dynamic";

export default async function CalendarioPage() {
  const adminClient = createAdminClient();
  const supabase = await createClient();

  // Load selectors in parallel
  const [propertiesRes, clientsRes, staffRes] = await Promise.all([
    adminClient
      .from("properties")
      .select("id, title, address, zone, status, bc_reference")
      .neq("status", "archived")
      .order("bc_reference", { ascending: true })
      .limit(1000),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "client")
      .order("full_name", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name, role")
      .in("role", ["owner", "admin", "advisor", "agent_junior", "agent_senior", "agent_admin"])
      .order("full_name", { ascending: true }),
  ]);

  return (
    <CalendarioClient
      properties={propertiesRes.data ?? []}
      clients={clientsRes.data ?? []}
      staff={staffRes.data ?? []}
    />
  );
}
