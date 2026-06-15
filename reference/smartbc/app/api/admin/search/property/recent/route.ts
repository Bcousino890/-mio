import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/server";
import { requireStaff } from "@/lib/db/auth-helpers";

export const dynamic = "force-dynamic";

// GET /api/admin/search/property/recent
// Returns up to 20 most recent available properties for the /propiedad dropdown.

export async function GET() {
  const supabase = await createClient();
  const auth = await requireStaff(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("properties")
    .select("id, slug, title, bc_reference, zone")
    .is("archived_at", null)
    .eq("status", "available")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ properties: data ?? [] });
}
