import "server-only";
import { getParticularesPage } from "@/lib/db/queries/particulares";
import { getCurrentProfile } from "@/lib/db/queries/session";

export async function GET(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const pageSize = 100;

  try {
    const { rows } = await getParticularesPage(offset, pageSize);
    return Response.json({ rows });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "query_failed" },
      { status: 500 },
    );
  }
}
