"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/db/auth-helpers";
import { createClient } from "@/lib/db/server";
import { runFeedById } from "@/lib/sync/runner";
import { listScraperKeys } from "@/lib/sync/scrapers";

export type CreateFeedInput = {
  agencyId: string;
  scraperKey: string;
  feedUrl?: string;
  frequencyHours?: number;
};

export type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

export async function createFeed(
  input: CreateFeedInput,
): Promise<ActionResult<{ feedId: string }>> {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth;

  if (!input.agencyId) return { ok: false, error: "agency_required" };
  if (!input.scraperKey) return { ok: false, error: "scraper_required" };
  if (!listScraperKeys().includes(input.scraperKey)) {
    return { ok: false, error: "scraper_not_registered" };
  }

  // Bypass de tipos para insert (mismo patrón que en agencias/actions.ts).
  const feedsTbl = supabase.from("agency_feeds") as unknown as {
    insert: (payload: Record<string, unknown>) => {
      select: (cols: string) => {
        maybeSingle: () => Promise<{
          data: { id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };

  const res = await feedsTbl
    .insert({
      agency_id: input.agencyId,
      scraper_key: input.scraperKey,
      feed_url: input.feedUrl?.trim() || null,
      frequency_hours: input.frequencyHours ?? 6,
      active: true,
      health: "idle",
    })
    .select("id")
    .maybeSingle();

  if (res.error) return { ok: false, error: res.error.message };
  if (!res.data) return { ok: false, error: "insert_no_row" };

  revalidatePath("/admin/sindicacion");
  return { ok: true, feedId: res.data.id };
}

export async function setFeedActive(
  feedId: string,
  active: boolean,
): Promise<ActionResult> {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth;

  const feedsTbl = supabase.from("agency_feeds") as unknown as {
    update: (payload: Record<string, unknown>) => {
      eq: (col: string, value: string) => Promise<{
        error: { message: string } | null;
      }>;
    };
  };
  const res = await feedsTbl.update({ active }).eq("id", feedId);
  if (res.error) return { ok: false, error: res.error.message };

  revalidatePath("/admin/sindicacion");
  return { ok: true };
}

export async function deleteFeed(feedId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth;

  const feedsTbl = supabase.from("agency_feeds") as unknown as {
    delete: () => {
      eq: (col: string, value: string) => Promise<{
        error: { message: string } | null;
      }>;
    };
  };
  const res = await feedsTbl.delete().eq("id", feedId);
  if (res.error) return { ok: false, error: res.error.message };

  revalidatePath("/admin/sindicacion");
  return { ok: true };
}

export async function syncFeedNow(
  feedId: string,
): Promise<
  ActionResult<{
    syncStatus: "success" | "partial" | "error";
    counters: {
      seen: number;
      inserted: number;
      updated: number;
      archived: number;
      skipped: number;
      photosProcessed: number;
    };
    errorMessage: string | null;
  }>
> {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth;

  // Evitar concurrencia: si la BD dice que el último estado del feed es
  // 'running', otro proceso ya lo está sincronizando.
  const stateRes = await supabase
    .from("agency_feeds")
    .select("last_status")
    .eq("id", feedId)
    .maybeSingle();
  if (
    stateRes.data &&
    (stateRes.data as { last_status: string | null }).last_status === "running"
  ) {
    return { ok: false, error: "already_running" };
  }

  try {
    const result = await runFeedById({ feedId, triggeredBy: "manual" });
    if (!result.ok) return { ok: false, error: result.error };
    revalidatePath("/admin/sindicacion");
    revalidatePath("/admin/propiedades");
    return {
      ok: true,
      syncStatus: result.result.status,
      counters: result.result.counters,
      errorMessage: result.result.errorMessage,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "sync_unknown_error",
    };
  }
}
