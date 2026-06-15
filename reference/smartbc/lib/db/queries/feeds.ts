import "server-only";
import { createClient } from "../server";
import type { AgencyFeedRow, FeedWithAgency, SyncLogRow } from "../row-types";

export type { AgencyFeedRow, FeedWithAgency, SyncLogRow };

export async function getFeedsWithAgency(): Promise<FeedWithAgency[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agency_feeds")
    .select("*, agencies(id, name, slug, logo_url)")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as FeedWithAgency[];
}

export async function getFeedById(id: string): Promise<FeedWithAgency | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agency_feeds")
    .select("*, agencies(id, name, slug, logo_url)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as FeedWithAgency | null) ?? null;
}

export async function getRecentSyncLogs(
  feedId: string,
  limit = 10,
): Promise<SyncLogRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sync_logs")
    .select("*")
    .eq("feed_id", feedId)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as unknown as SyncLogRow[];
}

export type FeedAggregateStats = {
  totalFeeds: number;
  activeFeeds: number;
  healthyFeeds: number;
  feedsWithErrors: number;
  syncedPropertiesLast24h: number;
};

export async function getFeedAggregateStats(): Promise<FeedAggregateStats> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [feedsRes, logsRes] = await Promise.all([
    supabase.from("agency_feeds").select("active, health"),
    supabase
      .from("sync_logs")
      .select(
        "properties_inserted, properties_updated, properties_archived, started_at",
      )
      .gte("started_at", since),
  ]);

  if (feedsRes.error) throw feedsRes.error;
  if (logsRes.error) throw logsRes.error;

  const feeds = (feedsRes.data ?? []) as Array<{
    active: boolean;
    health: "healthy" | "warning" | "error" | "idle";
  }>;
  const logs = (logsRes.data ?? []) as Array<{
    properties_inserted: number;
    properties_updated: number;
    properties_archived: number;
  }>;

  return {
    totalFeeds: feeds.length,
    activeFeeds: feeds.filter((f) => f.active).length,
    healthyFeeds: feeds.filter((f) => f.health === "healthy").length,
    feedsWithErrors: feeds.filter((f) => f.health === "error").length,
    syncedPropertiesLast24h: logs.reduce(
      (acc, l) =>
        acc +
        (l.properties_inserted ?? 0) +
        (l.properties_updated ?? 0) +
        (l.properties_archived ?? 0),
      0,
    ),
  };
}
