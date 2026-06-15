import "server-only";
import { createClient } from "@supabase/supabase-js";
import { extractFromUrl } from "@/lib/sync/import-by-link";
import { detectAdvertiserFromHtml } from "@/lib/sync/particulares/idealista-advertiser-detector";
import { fetchViaCurl } from "@/lib/sync/import-by-link/fetch-via-curl";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for up to 20 particulares

type SupabaseLike = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const WHATSAPP_UA = "WhatsApp/2.23.20.0";

interface RescrapeResult {
  particular_id: string;
  external_id: string;
  source_url: string;
  old_phone: string | null;
  new_phone: string | null;
  success: boolean;
  error?: string;
}

interface RescrapeSummary {
  ok: boolean;
  timestamp: string;
  total_checked: number;
  updated_count: number;
  still_missing: RescrapeResult[];
  results: RescrapeResult[];
  error?: string;
}

async function rescrapeParticularForPhone(
  supabase: SupabaseLike,
  particular: {
    id: string;
    external_id: string;
    source_url: string;
    phone: string | null;
  },
): Promise<RescrapeResult> {
  const result: RescrapeResult = {
    particular_id: particular.id,
    external_id: particular.external_id,
    source_url: particular.source_url,
    old_phone: particular.phone,
    new_phone: null,
    success: false,
  };

  try {
    // Fetch fresh HTML using WhatsApp UA via curl (passes DataDome on Idealista)
    console.log(
      `[rescrape-missing-phones] Fetching fresh HTML for ${particular.external_id}`,
    );
    const curlRes = await fetchViaCurl(particular.source_url, WHATSAPP_UA, {
      proxyUrl: process.env.SMARTPROXY_URL,
    });

    if (!curlRes.ok) {
      result.error = `Fetch failed: ${curlRes.reason}`;
      return result;
    }

    // Try to extract phone from the fresh HTML
    const advertiserInfo = detectAdvertiserFromHtml(curlRes.html);

    if (advertiserInfo.phone) {
      result.new_phone = advertiserInfo.phone;

      // Update DB with new phone (only if phone is null currently)
      // This ensures we don't overwrite an existing phone with the same or similar value
      const { error: updateError } = await supabase
        .from("particulares")
        .update({
          phone: advertiserInfo.phone,
          updated_at: new Date().toISOString(),
        })
        .eq("id", particular.id)
        .is("phone", null); // Only update if phone is currently NULL

      if (updateError) {
        result.error = `DB update failed: ${updateError.message}`;
        return result;
      }

      result.success = true;
      console.log(
        `[rescrape-missing-phones] ✓ Found phone for ${particular.external_id}: ${advertiserInfo.phone}`,
      );
    } else {
      result.error = "No phone found in fresh HTML";
      console.log(
        `[rescrape-missing-phones] ✗ Still no phone for ${particular.external_id}`,
      );
    }

    return result;
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : "Unknown error";
    result.error = errorMsg;
    console.error(
      `[rescrape-missing-phones] Error processing ${particular.external_id}: ${errorMsg}`,
    );
    return result;
  }
}

async function rescrapeParticularesWithMissingPhones(
  supabase: SupabaseLike,
  limit: number = 20,
): Promise<RescrapeSummary> {
  const now = new Date().toISOString();

  try {
    // Fetch up to `limit` active particulares where phone IS NULL
    console.log(
      `[rescrape-missing-phones] Fetching up to ${limit} particulares with missing phones...`,
    );

    const { data: particulares, error: fetchError } = await supabase
      .from("particulares")
      .select("id, external_id, source_url, phone")
      .eq("is_active", true)
      .is("phone", null)
      .order("updated_at", { ascending: true })
      .limit(limit);

    if (fetchError) {
      console.error(
        "[rescrape-missing-phones] Error fetching particulares:",
        fetchError,
      );
      return {
        ok: false,
        timestamp: now,
        total_checked: 0,
        updated_count: 0,
        still_missing: [],
        results: [],
        error: fetchError.message,
      };
    }

    const totalChecked = particulares?.length || 0;
    console.log(
      `[rescrape-missing-phones] Found ${totalChecked} particulares with missing phones`,
    );

    const results: RescrapeResult[] = [];
    let updatedCount = 0;
    const stillMissing: RescrapeResult[] = [];

    // Rescrape each one
    for (const particular of particulares || []) {
      const result = await rescrapeParticularForPhone(supabase, particular);
      results.push(result);

      if (result.success) {
        updatedCount++;
      } else {
        stillMissing.push(result);
      }
    }

    // Log summary
    console.log(`[rescrape-missing-phones] Summary:
  - Total checked: ${totalChecked}
  - Updated with phone: ${updatedCount}
  - Still missing phone: ${stillMissing.length}`);

    if (stillMissing.length > 0) {
      console.log(
        "[rescrape-missing-phones] Particulares still missing phones:",
      );
      for (const item of stillMissing) {
        console.log(`  - ${item.external_id}: ${item.error || "unknown error"}`);
      }
    }

    return {
      ok: true,
      timestamp: now,
      total_checked: totalChecked,
      updated_count: updatedCount,
      still_missing: stillMissing,
      results,
    };
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[rescrape-missing-phones] Error:", error);
    return {
      ok: false,
      timestamp: now,
      total_checked: 0,
      updated_count: 0,
      still_missing: [],
      results: [],
      error: errorMsg,
    };
  }
}

export async function POST(req: Request) {
  // Simple auth check using CRON_SECRET
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  try {
    // Optional limit via query param (?limit=20)
    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get("limit") ?? "20", 10) || 20));

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    console.log(`[rescrape-missing-phones] Starting rescrape job (limit: ${limit})`);
    const summary = await rescrapeParticularesWithMissingPhones(supabase, limit);

    return new Response(JSON.stringify(summary), { status: 200 });
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[rescrape-missing-phones] Endpoint error:", error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: errorMsg,
        timestamp: new Date().toISOString(),
      }),
      { status: 500 },
    );
  }
}
