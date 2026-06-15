import { NextResponse } from "next/server";
import { runDueFeeds } from "@/lib/sync/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Endpoint llamado por Vercel Cron (o cualquier scheduler externo) cada 6h.
// Protección: header `Authorization: Bearer ${CRON_SECRET}` o, cuando lo
// invoca Vercel Cron, la cabecera `x-vercel-cron` que el propio Vercel añade.
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  // Vercel Cron añade esta cabecera y solo es accesible internamente.
  if (req.headers.get("x-vercel-cron") === "1") return true;
  return false;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runDueFeeds();
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
