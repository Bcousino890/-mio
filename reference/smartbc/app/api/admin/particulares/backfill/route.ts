import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getCurrentProfile } from "@/lib/db/queries/session";
import { extractFromUrl } from "@/lib/sync/import-by-link";
import { fetchViaCurl } from "@/lib/sync/import-by-link/fetch-via-curl";
import { fetchIdealistaPhoneViaAjax } from "@/lib/sync/particulares/idealista-advertiser-detector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900; // 15 minutos

const WHATSAPP_UA = "WhatsApp/2.23.20.0";

// Mismo código de upsert del cron
async function upsertParticular(supabase: any, payload: any): Promise<boolean> {
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("particulares")
    .select("*")
    .eq("external_id", payload.external_id)
    .maybeSingle();

  if (existing) {
    const updateValues: Record<string, unknown> = {
      source_url: payload.source_url,
      owner_name: payload.contact_name ?? payload.owner_name,
      zone: payload.zone,
      address: payload.address,
      price: payload.price,
      bedrooms: payload.bedrooms,
      bathrooms: payload.bathrooms,
      square_meters: payload.square_meters,
      description: payload.description,
      features: payload.features,
      photos: payload.photos,
      phone: payload.phone ?? existing.phone,
      chat_only: !payload.phone && !existing.phone,
      latitude: payload.latitude,
      longitude: payload.longitude,
      advertiser_type: payload.advertiser_type,
      is_ad_professional: payload.is_ad_professional,
      is_active: true,
      taken_down_at: null,
      updated_at: now,
    };

    await supabase.from("particulares").update(updateValues).eq("id", existing.id);
    return true;
  }

  const insertValues: Record<string, unknown> = {
    portal: "idealista",
    external_id: payload.external_id,
    source_url: payload.source_url,
    owner_name: payload.contact_name ?? payload.owner_name,
    zone: payload.zone,
    address: payload.address,
    price: payload.price,
    operation: payload.operation,
    bedrooms: payload.bedrooms,
    bathrooms: payload.bathrooms,
    square_meters: payload.square_meters,
    description: payload.description,
    features: payload.features,
    photos: payload.photos,
    phone: payload.phone,
    chat_only: !payload.phone,
    latitude: payload.latitude,
    longitude: payload.longitude,
    advertiser_type: payload.advertiser_type,
    is_ad_professional: payload.is_ad_professional,
    is_active: true,
    detected_at: now,
    updated_at: now,
  };

  const { error } = await supabase.from("particulares").insert(insertValues);
  return !error;
}

export async function POST(req: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile || profile.role !== "admin") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { fromPage = 1, toPage = 100 } = await req.json();
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const results = {
      total_urls: 0,
      processed: 0,
      saved: 0,
      errors: 0,
      professionals: 0,
    };

    // Construir URLs - Madrid provincia (todas las viviendas)
    const searchBases = [
      "https://www.idealista.com/venta-viviendas/madrid-provincia/",
      "https://www.idealista.com/alquiler-viviendas/madrid-provincia/",
    ];

    const propertyUrls = new Set<string>();
    const sort = "?ordenado-por=fecha-publicacion-desc";

    // Extraer URLs de cada página
    for (const base of searchBases) {
      for (let page = fromPage; page <= toPage; page++) {
        const url = page === 1 ? `${base}${sort}` : `${base}pagina-${page}.htm${sort}`;

        console.log(`[backfill-particulares] Scraping: ${url}`);

        const res = await fetchViaCurl(url, WHATSAPP_UA, {
          proxyUrl: process.env.SMARTPROXY_URL,
        });

        if (!res.ok) {
          console.warn(`[backfill-particulares] Failed to fetch ${url}: ${res.reason}`);
          continue;
        }

        const matches = res.html.matchAll(/\/inmueble\/(\d+)/g);
        for (const match of matches) {
          if (match[1]) {
            propertyUrls.add(`https://www.idealista.com/inmueble/${match[1]}/`);
          }
        }
      }
    }

    results.total_urls = propertyUrls.size;
    console.log(`[backfill-particulares] Found ${propertyUrls.size} unique URLs`);

    // Procesar cada URL
    for (const url of propertyUrls) {
      try {
        const extracted = await extractFromUrl(url);

        if (!extracted.ok) {
          results.errors++;
          continue;
        }

        const { preview } = extracted;
        const advertiserInfo = preview.advertiserInfo;

        // Solo guardar particulares
        if (advertiserInfo?.advertiser_type === "professional") {
          results.professionals++;
          continue;
        }

        // Fallback AJAX para teléfono
        let phone = advertiserInfo?.phone ?? null;
        let phoneConfidence = advertiserInfo?.phone_confidence ?? null;

        if (!phone) {
          const adIdMatch = url.match(/\/inmueble\/(\d+)/);
          if (adIdMatch?.[1]) {
            const ajax = await fetchIdealistaPhoneViaAjax(adIdMatch[1], {
              proxyUrl: process.env.SMARTPROXY_URL,
            });
            if (ajax.phone) {
              phone = ajax.phone;
              phoneConfidence = ajax.phone_confidence;
            }
          }
        }

        const saved = await upsertParticular(supabase, {
          external_id: preview.externalReference,
          source_url: url,
          owner_name: preview.title ?? null,
          contact_name: advertiserInfo?.contact_name ?? null,
          zone: preview.zone ?? null,
          address: preview.address ?? null,
          price: preview.price ?? null,
          operation: preview.operation as "rent" | "sale" | null,
          bedrooms: preview.bedrooms ?? null,
          bathrooms: preview.bathrooms ?? null,
          square_meters: preview.squareMeters ?? null,
          description: preview.description ?? null,
          features: preview.features ?? [],
          photos: preview.photos ?? [],
          advertiser_type: advertiserInfo?.advertiser_type ?? "unknown",
          is_ad_professional: advertiserInfo?.is_ad_professional ?? null,
          phone,
          latitude: preview.latitude ?? null,
          longitude: preview.longitude ?? null,
        });

        if (saved) {
          results.saved++;
        } else {
          results.errors++;
        }

        results.processed++;
      } catch (err) {
        console.error(`[backfill-particulares] Error processing ${url}:`, err);
        results.errors++;
      }
    }

    console.log(`[backfill-particulares] Completed: ${results.saved} saved, ${results.errors} errors`);

    return Response.json({
      ok: true,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[backfill-particulares] Fatal error:", err);
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
