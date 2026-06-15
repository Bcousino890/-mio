import "server-only";
import { createClient } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/db/queries/session";

export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["owner", "admin", "advisor", "agent_admin", "agent_senior", "agent_junior"].includes(profile.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const searchParams = req.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");
    const zone = searchParams.get("zone");
    const operation = searchParams.get("operation");
    const portal = searchParams.get("portal");
    const minPrice = searchParams.get("minPrice");
    const maxPrice = searchParams.get("maxPrice");
    const hasPhone = searchParams.get("hasPhone");
    const search = searchParams.get("search");

    let query = supabase.from("particulares").select("*", { count: "exact" });

    if (zone) query = query.eq("zone", zone);
    if (operation) query = query.eq("operation", operation);
    if (portal) query = query.eq("portal", portal);

    if (minPrice) {
      const min = parseInt(minPrice);
      query = query.gte("price", min);
    }
    if (maxPrice) {
      const max = parseInt(maxPrice);
      query = query.lte("price", max);
    }

    if (hasPhone === "true") {
      query = query.not("phone", "is", null);
    }

    if (search) {
      const q = search.toLowerCase();
      query = query.or(
        `owner_name.ilike.%${q}%,zone.ilike.%${q}%,description.ilike.%${q}%`
      );
    }

    query = query
      .eq("is_active", true)
      .order("detected_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      return Response.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return Response.json({
      data,
      count,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[API] Error fetching particulares:", error);
    return Response.json(
      { error: "Error fetching particulares" },
      { status: 500 }
    );
  }
}
