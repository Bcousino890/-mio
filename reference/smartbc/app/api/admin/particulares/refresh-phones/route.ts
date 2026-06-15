import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { getCurrentProfile } from "@/lib/db/queries/session";
import { canAccess } from "@/lib/permissions";
import { detectAdvertiserFromHtml } from "@/lib/sync/particulares/idealista-advertiser-detector";
import { fetchViaCurl } from "@/lib/sync/import-by-link/fetch-via-curl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const WHATSAPP_UA = "WhatsApp/2.23.20.0";

export async function POST(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile || !canAccess(profile.role, "particulares", "edit")) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number.parseInt(searchParams.get("limit") ?? "20", 10) || 20));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;
  const now = new Date().toISOString();

  const { data: rows, error } = await db
    .from("particulares")
    .select("id, external_id, source_url, phone")
    .eq("is_active", true)
    .is("phone", null)
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  let updated = 0;
  let still_missing = 0;

  for (const row of rows ?? []) {
    try {
      const res = await fetchViaCurl(row.source_url, WHATSAPP_UA, {
        proxyUrl: process.env.SMARTPROXY_URL,
      });
      if (!res.ok) { still_missing++; continue; }

      const info = detectAdvertiserFromHtml(res.html);
      if (info.phone) {
        await db
          .from("particulares")
          .update({ phone: info.phone, chat_only: false, updated_at: now })
          .eq("id", row.id)
          .is("phone", null);
        await db.from("particulares_changes").insert({
          particular_id: row.id,
          change_type: "phone_added",
          old_value: null,
          new_value: { phone: info.phone },
          changed_at: now,
        });
        updated++;
      } else {
        // Re-verificado sin teléfono real → solo se puede contactar por chat.
        await db
          .from("particulares")
          .update({ chat_only: true, updated_at: now })
          .eq("id", row.id)
          .is("phone", null);
        still_missing++;
      }
    } catch {
      still_missing++;
    }
  }

  return Response.json({
    ok: true,
    checked: rows?.length ?? 0,
    updated,
    still_missing,
    timestamp: now,
  });
}
