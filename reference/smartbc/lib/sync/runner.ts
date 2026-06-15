import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { runSyncForFeed } from "./diff-engine";
import { getScraperByKey } from "./scrapers";
import type { SyncResult } from "./types";

type RunFeedOptions = {
  feedId: string;
  triggeredBy: "cron" | "manual" | "test";
};

type RunFeedFailure = {
  ok: false;
  error:
    | "feed_not_found"
    | "agency_missing"
    | "scraper_not_registered"
    | "already_running";
};

type RunFeedSuccess = { ok: true; result: SyncResult };

// Un sync normal tarda minutos. Si un feed lleva "running" más que esto, el
// proceso que lo arrancó murió a media (p.ej. un reinicio de pm2 lo cortó) y el
// estado se quedó "running" para siempre, bloqueando futuros syncs. Lo damos por
// muerto y dejamos que se relance (auto-recuperación).
const STALE_RUNNING_MS = 30 * 60 * 1000;

function isStaleRunning(
  lastStatus: string | null,
  updatedAt: string | null,
): boolean {
  if (lastStatus !== "running") return false;
  if (!updatedAt) return true;
  return Date.now() - new Date(updatedAt).getTime() > STALE_RUNNING_MS;
}

export async function runFeedById(
  options: RunFeedOptions,
): Promise<RunFeedSuccess | RunFeedFailure> {
  const supabase = createAdminClient();
  const feedRes = await supabase
    .from("agency_feeds")
    .select("*, agencies(id, slug)")
    .eq("id", options.feedId)
    .maybeSingle();

  if (feedRes.error) throw new Error(feedRes.error.message);
  if (!feedRes.data) return { ok: false, error: "feed_not_found" };

  const row = feedRes.data as unknown as {
    id: string;
    agency_id: string;
    scraper_key: string;
    feed_url: string | null;
    last_status: string | null;
    updated_at: string | null;
    agencies: { id: string; slug: string } | null;
  };
  if (!row.agencies) return { ok: false, error: "agency_missing" };

  // Guarda contra concurrencia: si el feed YA está corriendo (y no es un running
  // colgado/muerto), salimos sin tocar nada para que dos disparos (manual + cron,
  // o dos crones que se solapan) no se pisen ni creen errores de duplicate-key.
  if (
    row.last_status === "running" &&
    !isStaleRunning(row.last_status, row.updated_at)
  ) {
    return { ok: false, error: "already_running" };
  }

  const scraper = getScraperByKey(row.scraper_key);
  if (!scraper) return { ok: false, error: "scraper_not_registered" };

  const result = await runSyncForFeed({
    feedId: row.id,
    agencyId: row.agency_id,
    agencySlug: row.agencies.slug,
    scraper,
    feedUrl: row.feed_url,
    triggeredBy: options.triggeredBy,
  });
  return { ok: true, result };
}

export async function runDueFeeds(): Promise<{
  attempted: number;
  results: Array<{ feedId: string; status: SyncResult["status"] | "error" }>;
}> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const dueRes = await supabase
    .from("agency_feeds")
    .select("id, last_status, updated_at")
    .eq("active", true)
    .or(`next_run_at.is.null,next_run_at.lte.${now}`);
  if (dueRes.error) throw new Error(dueRes.error.message);

  // Excluimos los feeds que están corriendo AHORA (no los "running" colgados de
  // un proceso muerto, que sí relanzamos). Filtramos en JS porque Postgres trata
  // NULL != 'running' como NULL, no true, así que un .neq() excluiría también los
  // reseteados con last_status=NULL.
  const ids = (
    (dueRes.data ?? []) as Array<{
      id: string;
      last_status: string | null;
      updated_at: string | null;
    }>
  )
    .filter(
      (r) =>
        r.last_status !== "running" ||
        isStaleRunning(r.last_status, r.updated_at),
    )
    .map((r) => r.id);
  const results: Array<{
    feedId: string;
    status: SyncResult["status"] | "error";
  }> = [];

  for (const id of ids) {
    try {
      const r = await runFeedById({ feedId: id, triggeredBy: "cron" });
      results.push({
        feedId: id,
        status: r.ok ? r.result.status : "error",
      });
    } catch {
      results.push({ feedId: id, status: "error" });
    }
  }
  return { attempted: ids.length, results };
}
