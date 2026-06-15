import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { FeedsStatsBlock } from "@/components/admin/feeds-stats";
import {
  RecentSyncsPanel,
  type RecentSyncVM,
} from "@/components/admin/recent-syncs";
import { SindicacionShell } from "@/components/admin/sindicacion-shell";
import type { FeedRowVM } from "@/components/admin/feeds-table";
import { PageFooter } from "@/components/ui/page-footer";
import { minutesSince } from "@/lib/db/adapters";
import { getAgencies } from "@/lib/db/queries/agencies";
import {
  getFeedAggregateStats,
  getFeedsWithAgency,
} from "@/lib/db/queries/feeds";
import { createClient } from "@/lib/db/server";
import { getScraperByKey, listScraperKeys } from "@/lib/sync/scrapers";

export default async function AdminSindicacionPage() {
  const [feeds, stats, allAgencies] = await Promise.all([
    getFeedsWithAgency(),
    getFeedAggregateStats(),
    getAgencies(),
  ]);

  const supabase = await createClient();
  const recentLogsRes = await supabase
    .from("sync_logs")
    .select(
      "id, started_at, finished_at, status, triggered_by, properties_inserted, properties_updated, properties_archived, error_message, feed_id, agency_feeds(agency_id, agencies(name))",
    )
    .order("started_at", { ascending: false })
    .limit(15);

  type LogJoin = {
    id: string;
    started_at: string;
    finished_at: string | null;
    status: "running" | "success" | "partial" | "error";
    triggered_by: string;
    properties_inserted: number;
    properties_updated: number;
    properties_archived: number;
    error_message: string | null;
    agency_feeds:
      | {
          agencies: { name: string } | { name: string }[] | null;
        }
      | Array<{
          agencies: { name: string } | { name: string }[] | null;
        }>
      | null;
  };

  function pickName(row: LogJoin): string {
    const feed = Array.isArray(row.agency_feeds)
      ? row.agency_feeds[0]
      : row.agency_feeds;
    if (!feed) return "—";
    const agency = Array.isArray(feed.agencies)
      ? feed.agencies[0]
      : feed.agencies;
    return agency?.name ?? "—";
  }

  const recentLogs: RecentSyncVM[] = (
    (recentLogsRes.data ?? []) as unknown as LogJoin[]
  ).map((row) => ({
    id: row.id,
    agencyName: pickName(row),
    status: row.status,
    triggeredBy: row.triggered_by,
    startedMinutesAgo: minutesSince(row.started_at),
    durationSeconds: row.finished_at
      ? Math.max(
          0,
          Math.round(
            (new Date(row.finished_at).getTime() -
              new Date(row.started_at).getTime()) /
              1000,
          ),
        )
      : null,
    inserted: row.properties_inserted,
    updated: row.properties_updated,
    archived: row.properties_archived,
    errorMessage: row.error_message,
  }));

  const feedRows: FeedRowVM[] = feeds.map((f) => ({
    id: f.id,
    agencyName: f.agencies?.name ?? "—",
    agencySlug: f.agencies?.slug ?? "",
    scraperKey: f.scraper_key,
    active: f.active,
    health: f.health,
    lastStatus: f.last_status,
    lastError: f.last_error,
    lastRunMinutesAgo: f.last_run_at ? minutesSince(f.last_run_at) : null,
    frequencyHours: f.frequency_hours,
  }));

  const usedAgencyIds = new Set(feeds.map((f) => f.agency_id));
  type AgencyLite = { id: string; name: string; slug: string };
  const agenciesWithoutFeed = ((allAgencies ?? []) as unknown as AgencyLite[])
    .filter((a) => !usedAgencyIds.has(a.id))
    .map((a) => ({ id: a.id, name: a.name, slug: a.slug }));

  const scrapers = listScraperKeys().map((key) => {
    const scraper = getScraperByKey(key);
    return { key, label: scraper?.label ?? key };
  });

  return (
    <div className="mx-auto flex min-h-screen max-w-[1200px] flex-col px-6 pb-10 lg:px-10">
      <AdminPageHeader
        titleKey="sindicacion.title"
        subtitleKey="sindicacion.subtitle"
      />

      <div className="mt-7">
        <FeedsStatsBlock stats={stats} />
      </div>

      <div className="mt-5">
        <SindicacionShell
          feeds={feedRows}
          agenciesWithoutFeed={agenciesWithoutFeed}
          scrapers={scrapers}
        />
      </div>

      <div className="mt-5">
        <RecentSyncsPanel logs={recentLogs} />
      </div>

      <PageFooter textKey="admin.realtime.footer" variant="inline" />
    </div>
  );
}
