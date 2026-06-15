import "server-only";
import { createClient } from "@supabase/supabase-js";
import { fetchViaCurl } from "@/lib/sync/import-by-link/fetch-via-curl";

// Detección de bajas para propiedades importadas por link
// (`/admin/propiedades/importar`). Cada run revisita una muestra de las
// propiedades activas con `source='manual'` y `source_url` válido. Si la
// URL original devuelve 404 (el dueño retiró el anuncio del portal), la
// archivamos automáticamente para que no aparezca como disponible.
//
// Por qué solo `source='manual'`: las propiedades de sindicación
// (source='scrape', p.ej. Level) las maneja el cron de sync, no este. Las
// altas manuales escritas a mano (sin source_url) tampoco aplican.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// Tipo laxo: usamos `createClient` sin genéricos y los casts puntuales.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

const WHATSAPP_UA = "WhatsApp/2.23.20.0";
const LIMIT = Number.parseInt(
  process.env.CHECK_BAJAS_LIMIT ?? "30",
  10,
);

export async function POST(req: Request) {
  if (req.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  try {
    const result = await checkImportedListings(supabase);
    return Response.json({
      ok: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}

async function checkImportedListings(supabase: SupabaseLike) {
  // Propiedades importadas por link que están activas y llevan más tiempo
  // sin verificarse — así rotamos la revisión progresivamente.
  const { data } = await supabase
    .from("properties")
    .select("id, source_url, slug, updated_at")
    .eq("source", "manual")
    .not("source_url", "is", null)
    .is("archived_at", null)
    .neq("status", "archived")
    .order("updated_at", { ascending: true })
    .limit(LIMIT);

  let archived = 0;
  let alive = 0;
  let uncertain = 0;
  const rows = (data ?? []) as Array<{ id: string; source_url: string | null; slug: string }>;

  for (const row of rows) {
    if (!row.source_url) continue;

    // UA WhatsApp + proxy: pasa Idealista (DataDome). Para Fotocasa/Inmoweb
    // funciona también con curl directo; el proxy es defensivo.
    const res = await fetchViaCurl(row.source_url, WHATSAPP_UA, {
      proxyUrl: process.env.SMARTPROXY_URL,
    });
    const now = new Date().toISOString();

    if (res.ok) {
      // Anuncio sigue vivo — refrescamos updated_at para mover a la cola.
      await supabase
        .from("properties")
        .update({ updated_at: now })
        .eq("id", row.id);
      alive++;
    } else if (res.status === 404) {
      // Baja confirmada — archivamos.
      await supabase
        .from("properties")
        .update({
          archived_at: now,
          status: "archived",
          updated_at: now,
        })
        .eq("id", row.id);
      archived++;
      console.log(
        `[check-bajas] archivada por 404: ${row.slug} (${row.source_url})`,
      );
    } else {
      // Error transitorio (403, 5xx, red) — no tocamos; se revisita en el
      // próximo run, idealmente cuando el portal se recupere.
      uncertain++;
    }
  }

  return { processed: rows.length, archived, alive, uncertain };
}
