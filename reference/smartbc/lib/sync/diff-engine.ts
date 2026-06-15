import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { normalizeRawProperty } from "./normalizer";
import type {
  NormalizedProperty,
  RawProperty,
  Scraper,
  SyncCounters,
  SyncResult,
} from "./types";
import { downloadAndWatermark } from "./watermark";

type AdminClient = ReturnType<typeof createAdminClient>;

type ExistingProperty = {
  id: string;
  external_id: string | null;
  title: string;
  description: string | null;
  property_type: string | null;
  price: number;
  bedrooms: number;
  bathrooms: number;
  square_meters: number | null;
  zone: string;
  subzone: string | null;
  address: string | null;
  available_from: string | null;
  features: string[];
  archived_at: string | null;
  status: string;
};

function emptyCounters(): SyncCounters {
  return {
    seen: 0,
    inserted: 0,
    updated: 0,
    archived: 0,
    skipped: 0,
    photosProcessed: 0,
  };
}

function needsUpdate(
  existing: ExistingProperty,
  normalized: NormalizedProperty,
): boolean {
  if (existing.archived_at) return true; // desarchivar
  if (Number(existing.price) !== normalized.price) return true;
  if (existing.title !== normalized.title) return true;
  if ((existing.description ?? null) !== normalized.description) return true;
  if ((existing.property_type ?? null) !== normalized.property_type) return true;
  if (existing.bedrooms !== normalized.bedrooms) return true;
  if (existing.bathrooms !== normalized.bathrooms) return true;
  if ((existing.square_meters ?? null) !== normalized.square_meters) return true;
  if (existing.zone !== normalized.zone) return true;
  if ((existing.subzone ?? null) !== normalized.subzone) return true;
  if ((existing.address ?? null) !== normalized.address) return true;
  if ((existing.available_from ?? null) !== normalized.available_from)
    return true;
  if (
    JSON.stringify((existing.features ?? []).slice().sort()) !==
    JSON.stringify(normalized.features.slice().sort())
  )
    return true;
  return false;
}

async function processPhotos(
  agencySlug: string,
  normalized: NormalizedProperty,
  rehost: boolean,
): Promise<{ urls: string[]; processed: number; failed: number }> {
  // Sin re-alojado: guardamos las URLs de origen tal cual (el proxy las
  // neutraliza). Instantáneo, para agencias con fotos limpias de CDN fiable.
  if (!rehost) {
    const urls = normalized.photos.map((p) => p.url);
    return { urls, processed: urls.length, failed: 0 };
  }
  // Lotes CONCURRENTES (no de una en una): con agencias de muchas fotos por
  // ficha (UrbantecHome ~25), en serie el primer sync tardaba demasiado.
  // Conservamos el ORDEN (resultados indexados por posición original).
  const CONCURRENCY = 6;
  const results: (string | null)[] = new Array(normalized.photos.length).fill(
    null,
  );
  for (let start = 0; start < normalized.photos.length; start += CONCURRENCY) {
    const batch = normalized.photos.slice(start, start + CONCURRENCY);
    await Promise.all(
      batch.map(async (photo, j) => {
        const i = start + j;
        const result = await downloadAndWatermark({
          sourceUrl: photo.url,
          agencySlug,
          externalId: normalized.external_id,
          position: i,
        });
        if (result.ok) results[i] = result.photo.url;
      }),
    );
  }
  const urls = results.filter((u): u is string => u !== null);
  const processed = urls.length;
  const failed = normalized.photos.length - processed;
  return { urls, processed, failed };
}

async function insertProperty(
  supabase: AdminClient,
  agencyId: string,
  agencySlug: string,
  normalized: NormalizedProperty,
  counters: SyncCounters,
  rehost: boolean,
): Promise<void> {
  const { urls, processed } = await processPhotos(agencySlug, normalized, rehost);
  counters.photosProcessed += processed;
  const coverUrl = urls[0] ?? null;

  const propertiesTbl = supabase.from("properties") as unknown as {
    insert: (payload: Record<string, unknown>) => {
      select: (cols: string) => {
        maybeSingle: () => Promise<{
          data: { id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };

  const inserted = await propertiesTbl
    .insert({
      agency_id: agencyId,
      source: "scrape",
      external_id: normalized.external_id,
      slug: normalized.slug,
      title: normalized.title,
      description: normalized.description,
      operation: normalized.operation,
      stay: normalized.stay,
      property_type: normalized.property_type,
      status: "available",
      price: normalized.price,
      bedrooms: normalized.bedrooms,
      bathrooms: normalized.bathrooms,
      square_meters: normalized.square_meters,
      zone: normalized.zone,
      subzone: normalized.subzone,
      address: normalized.address,
      available_from: normalized.available_from,
      features: normalized.features,
      cover_photo_url: coverUrl,
      source_url: normalized.source_url,
      last_synced_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (inserted.error) throw new Error(inserted.error.message);
  if (!inserted.data) throw new Error("insert_no_row");

  if (urls.length > 0) {
    const photoRows = urls.map((url, idx) => ({
      property_id: inserted.data!.id,
      url,
      position: idx,
      is_cover: idx === 0,
    }));
    const photosTbl = supabase.from("property_photos") as unknown as {
      insert: (
        rows: Array<Record<string, unknown>>,
      ) => Promise<{ error: { message: string } | null }>;
    };
    const photosRes = await photosTbl.insert(photoRows);
    if (photosRes.error) throw new Error(photosRes.error.message);
  }
}

// IMPORTANTE: este UPDATE solo toca los campos que vienen del scraper.
// Los campos internos del admin (owner_*, internal_notes, features_manual)
// NO se incluyen adrede — son siempre propiedad del admin y nunca se
// sobrescriben en sync.
async function updateExistingProperty(
  supabase: AdminClient,
  existing: ExistingProperty,
  normalized: NormalizedProperty,
): Promise<void> {
  const propertiesTbl = supabase.from("properties") as unknown as {
    update: (payload: Record<string, unknown>) => {
      eq: (col: string, value: string) => Promise<{
        error: { message: string } | null;
      }>;
    };
  };

  const res = await propertiesTbl
    .update({
      title: normalized.title,
      description: normalized.description,
      property_type: normalized.property_type,
      price: normalized.price,
      bedrooms: normalized.bedrooms,
      bathrooms: normalized.bathrooms,
      square_meters: normalized.square_meters,
      zone: normalized.zone,
      subzone: normalized.subzone,
      address: normalized.address,
      available_from: normalized.available_from,
      features: normalized.features,
      source_url: normalized.source_url,
      last_synced_at: new Date().toISOString(),
      archived_at: null,
      status: existing.archived_at ? "available" : existing.status,
    })
    .eq("id", existing.id);
  if (res.error) throw new Error(res.error.message);
}

async function archiveProperty(
  supabase: AdminClient,
  propertyId: string,
): Promise<void> {
  const propertiesTbl = supabase.from("properties") as unknown as {
    update: (payload: Record<string, unknown>) => {
      eq: (col: string, value: string) => Promise<{
        error: { message: string } | null;
      }>;
    };
  };
  const res = await propertiesTbl
    .update({
      archived_at: new Date().toISOString(),
      status: "archived",
    })
    .eq("id", propertyId);
  if (res.error) throw new Error(res.error.message);
}

export async function runSyncForFeed(params: {
  feedId: string;
  agencyId: string;
  agencySlug: string;
  scraper: Scraper;
  feedUrl: string | null;
  triggeredBy: "cron" | "manual" | "test";
}): Promise<SyncResult> {
  const supabase = createAdminClient();
  const counters = emptyCounters();
  const startedAt = new Date().toISOString();

  // Crear sync_log inicial
  const logsTblInsert = supabase.from("sync_logs") as unknown as {
    insert: (payload: Record<string, unknown>) => {
      select: (cols: string) => {
        maybeSingle: () => Promise<{
          data: { id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  const logCreate = await logsTblInsert
    .insert({
      feed_id: params.feedId,
      started_at: startedAt,
      status: "running",
      triggered_by: params.triggeredBy,
    })
    .select("id")
    .maybeSingle();
  if (logCreate.error || !logCreate.data) {
    throw new Error(logCreate.error?.message ?? "sync_log_insert_failed");
  }
  const logId = logCreate.data.id;

  const feedsTbl = supabase.from("agency_feeds") as unknown as {
    update: (payload: Record<string, unknown>) => {
      eq: (col: string, value: string) => Promise<{
        error: { message: string } | null;
      }>;
    };
  };
  await feedsTbl.update({ last_status: "running" }).eq("id", params.feedId);

  let rawProps: RawProperty[] = [];
  let liveExternalIds: Set<string> | null = null;
  let errorMessage: string | null = null;
  let status: SyncResult["status"] = "success";

  try {
    // Si el scraper expone listExternalIds(), lo llamamos PRIMERO y barato.
    // Esa lista es la autoridad sobre qué propiedades siguen vivas en el
    // origen. Sin esto, un scrape parcial (LIMIT) archivaría todo lo demás.
    if (params.scraper.listExternalIds) {
      try {
        const ids = await params.scraper.listExternalIds();
        liveExternalIds = new Set(ids);
      } catch (err) {
        // Si falla, caemos al modo conservador: NO archivamos (mejor mantener
        // algo zombi en BD que borrar producción por error de red).
        errorMessage =
          err instanceof Error ? err.message : "list_external_ids_failed";
      }
    }
    rawProps = await params.scraper.scrape({ feedUrl: params.feedUrl });
  } catch (err) {
    errorMessage =
      err instanceof Error ? err.message : "scraper_unknown_error";
    status = "error";
  }

  if (status !== "error") {
    counters.seen = rawProps.length;
    const normalizedList = rawProps.map((r) =>
      normalizeRawProperty(r, params.agencySlug),
    );

    // Cargar properties scrape existentes de esta agencia
    const existingRes = await supabase
      .from("properties")
      .select(
        "id, external_id, title, description, property_type, price, bedrooms, bathrooms, square_meters, zone, subzone, address, available_from, features, archived_at, status",
      )
      .eq("agency_id", params.agencyId)
      .eq("source", "scrape");

    if (existingRes.error) {
      errorMessage = existingRes.error.message;
      status = "error";
    } else {
      const existingByExternal = new Map<string, ExistingProperty>();
      for (const e of (existingRes.data ?? []) as unknown as ExistingProperty[]) {
        if (e.external_id) existingByExternal.set(e.external_id, e);
      }

      const seenExternal = new Set<string>();
      let partialError = false;

      for (const normalized of normalizedList) {
        seenExternal.add(normalized.external_id);
        const existing = existingByExternal.get(normalized.external_id);
        try {
          if (!existing) {
            await insertProperty(
              supabase,
              params.agencyId,
              params.agencySlug,
              normalized,
              counters,
              params.scraper.rehostPhotos !== false,
            );
            counters.inserted++;
          } else if (needsUpdate(existing, normalized)) {
            await updateExistingProperty(supabase, existing, normalized);
            counters.updated++;
          } else {
            counters.skipped++;
          }
        } catch (err) {
          partialError = true;
          errorMessage =
            err instanceof Error
              ? err.message
              : `process_failed_${normalized.external_id}`;
        }
      }

      // Archivar las que dejaron de aparecer en el ORIGEN (no en este sync).
      // Archivar las que dejaron de aparecer en origen.
      // - Si el scraper expone `listExternalIds()`, esa lista es autoritativa:
      //   archivamos solo lo que está en BD y NO está en ella. Esto permite
      //   scrape() parciales (LIMIT) sin archivar las propiedades fuera del
      //   límite.
      // - Si no la expone (e.g. scraper `_test`), asumimos que `scrape()`
      //   devolvió TODO y usamos `seenExternal` como antes.
      const archiveSource: Set<string> = liveExternalIds ?? seenExternal;
      for (const [externalId, existing] of existingByExternal.entries()) {
        if (archiveSource.has(externalId)) continue;
        if (existing.archived_at) continue;
        try {
          await archiveProperty(supabase, existing.id);
          counters.archived++;
        } catch (err) {
          partialError = true;
          errorMessage =
            err instanceof Error
              ? err.message
              : `archive_failed_${existing.id}`;
        }
      }

      if (partialError) status = "partial";
    }
  }

  const finishedAt = new Date().toISOString();
  const logsTblUpdate = supabase.from("sync_logs") as unknown as {
    update: (payload: Record<string, unknown>) => {
      eq: (col: string, value: string) => Promise<{
        error: { message: string } | null;
      }>;
    };
  };
  await logsTblUpdate
    .update({
      finished_at: finishedAt,
      status,
      properties_seen: counters.seen,
      properties_inserted: counters.inserted,
      properties_updated: counters.updated,
      properties_archived: counters.archived,
      properties_skipped: counters.skipped,
      photos_processed: counters.photosProcessed,
      error_message: errorMessage,
    })
    .eq("id", logId);

  const health =
    status === "error"
      ? "error"
      : status === "partial"
        ? "warning"
        : "healthy";
  const nextRunAt = new Date(
    Date.now() + 6 * 60 * 60 * 1000,
  ).toISOString();

  await feedsTbl
    .update({
      last_run_at: finishedAt,
      last_status: status,
      last_error: errorMessage,
      health,
      next_run_at: nextRunAt,
    })
    .eq("id", params.feedId);

  return {
    status,
    counters,
    errorMessage,
    details: { logId },
  };
}
