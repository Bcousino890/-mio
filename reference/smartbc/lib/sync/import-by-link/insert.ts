import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { downloadAndWatermark } from "../watermark";
import type { ImportPreview } from "./types";

// Inserta una propiedad importada por link. Para que "Crear propiedad" sea
// INSTANTÁNEO aunque la ficha tenga muchas fotos (UrbantecHome trae 30-46), NO
// procesamos las fotos de forma síncrona: insertamos la propiedad + las filas de
// foto con las URLs de ORIGEN y devolvemos ya. El re-alojado (descarga + quitar
// marca + subir a nuestro storage) ocurre en SEGUNDO PLANO y va sustituyendo las
// URLs. Mientras tanto el proxy /p/{slug}/{idx} ya neutraliza el origen.
// Se distingue de otras altas por `properties.source = 'manual'`.

export type InsertImportInput = {
  preview: ImportPreview;
  agencyId: string;
  agencySlug: string;
  overrides: {
    title: string;
    description: string | null;
    operation: "rent" | "sale";
    stay: "long" | "short" | null;
    price: number;
    bedrooms: number;
    bathrooms: number;
    squareMeters: number | null;
    zone: string;
    address: string | null;
    features: string[];
    externalReference: string;
  };
};

export type InsertImportResult =
  | { ok: true; propertyId: string; slug: string; photosProcessed: number }
  | { ok: false; error: string };

function normalizeSlug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Re-aloja las fotos en segundo plano: descarga cada una, le quita la marca (si
// la fuente tiene perfil), la sube a nuestro storage y actualiza la fila para
// que apunte a la copia propia en vez de a la URL de origen. Se ejecuta sin
// await; en el VPS (pm2) el proceso sigue vivo tras responder. Si el proceso se
// reinicia a medias, las fotos no re-alojadas conservan su URL de origen (que
// sigue funcionando vía el proxy) y una re-importación las regenera.
async function rehostPhotosInBackground(params: {
  propertyId: string;
  agencySlug: string;
  externalId: string;
  sources: string[];
}): Promise<void> {
  const { propertyId, agencySlug, externalId, sources } = params;
  const supabase = createAdminClient();
  const photosUpd = supabase.from("property_photos") as unknown as {
    update: (p: Record<string, unknown>) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: number) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
  const propsUpd = supabase.from("properties") as unknown as {
    update: (p: Record<string, unknown>) => {
      eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
    };
  };

  const CONCURRENCY = 8;
  for (let start = 0; start < sources.length; start += CONCURRENCY) {
    const batch = sources.slice(start, start + CONCURRENCY);
    await Promise.all(
      batch.map(async (sourceUrl, j) => {
        const i = start + j;
        try {
          const res = await downloadAndWatermark({
            sourceUrl,
            agencySlug,
            externalId,
            position: i,
          });
          if (!res.ok) return;
          await photosUpd
            .update({ url: res.photo.url })
            .eq("property_id", propertyId)
            .eq("position", i);
          if (i === 0) {
            await propsUpd
              .update({ cover_photo_url: res.photo.url })
              .eq("id", propertyId);
          }
        } catch {
          // Una foto que falla no aborta el resto; conserva su URL de origen.
        }
      }),
    );
  }
  // Refrescar last_synced_at para invalidar la caché del proxy de fotos (su
  // versión depende de las URLs + last_synced_at), ahora que apuntan a storage.
  await propsUpd
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", propertyId);
}

export async function insertImportedProperty(
  input: InsertImportInput,
): Promise<InsertImportResult> {
  const { preview, agencyId, agencySlug, overrides } = input;
  const supabase = createAdminClient();

  const baseSlug = normalizeSlug(overrides.title || "propiedad");
  if (!baseSlug) return { ok: false, error: "slug_invalid" };
  const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

  // Filas de foto con las URLs de ORIGEN (sin procesar todavía).
  const sources = preview.photos.map((p) => p.url);

  // La PORTADA sí se procesa síncrona (1 sola foto, rápido): el catálogo la
  // muestra con next/image, que solo admite nuestros dominios. Así cubrimos
  // cualquier portal sin abrir next/image a hosts arbitrarios. Si falla, cae a
  // la URL de origen y el re-alojado de fondo la arreglará.
  let coverUrl = sources[0] ?? null;
  if (sources[0]) {
    const c = await downloadAndWatermark({
      sourceUrl: sources[0],
      agencySlug,
      externalId: overrides.externalReference,
      position: 0,
    });
    if (c.ok) coverUrl = c.photo.url;
  }

  // Campos comunes a alta nueva y re-importación (todo menos los inmutables:
  // agency_id, external_id, slug, source y status).
  const commonFields: Record<string, unknown> = {
    title: overrides.title,
    description: overrides.description,
    operation: overrides.operation,
    stay: overrides.stay,
    price: overrides.price,
    bedrooms: overrides.bedrooms,
    bathrooms: overrides.bathrooms,
    square_meters: overrides.squareMeters,
    zone: overrides.zone,
    address: overrides.address,
    features: overrides.features,
    cover_photo_url: coverUrl,
    source_url: preview.sourceUrl,
    latitude: preview.latitude,
    longitude: preview.longitude,
    last_synced_at: new Date().toISOString(),
    // Fecha de "publicación": se refresca también en re-importación para que la
    // ficha suba al principio del listado (ordenado por created_at desc).
    created_at: new Date().toISOString(),
  };

  // ¿Ya existe (misma agencia + referencia)? Entonces es RE-IMPORTACIÓN.
  const lookupTbl = supabase.from("properties") as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => {
          maybeSingle: () => Promise<{
            data: { id: string; slug: string; status: string | null } | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
  const existing = await lookupTbl
    .select("id, slug, status")
    .eq("agency_id", agencyId)
    .eq("external_id", overrides.externalReference)
    .maybeSingle();
  if (existing.error) return { ok: false, error: existing.error.message };

  let propertyId: string;
  let resultSlug: string;

  if (existing.data) {
    // --- RE-IMPORTACIÓN: update + reemplazo de fotos ---
    propertyId = existing.data.id;
    resultSlug = existing.data.slug; // conservamos la URL existente
    const updTbl = supabase.from("properties") as unknown as {
      update: (payload: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    };
    // Reimportar = "quiero esta propiedad activa": la desarchivamos siempre y, si
    // estaba archivada, la devolvemos a 'available' (respeta reserved/sold).
    const reactivate: Record<string, unknown> = { archived_at: null };
    if (existing.data.status === "archived" || existing.data.status === null) {
      reactivate.status = "available";
    }
    const upd = await updTbl
      .update({ ...commonFields, ...reactivate })
      .eq("id", propertyId);
    if (upd.error) return { ok: false, error: upd.error.message };

    const delTbl = supabase.from("property_photos") as unknown as {
      delete: () => {
        eq: (
          c: string,
          v: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    };
    const del = await delTbl.delete().eq("property_id", propertyId);
    if (del.error) return { ok: false, error: del.error.message };
  } else {
    // --- ALTA NUEVA ---
    const propsTbl = supabase.from("properties") as unknown as {
      insert: (payload: Record<string, unknown>) => {
        select: (cols: string) => {
          maybeSingle: () => Promise<{
            data: { id: string; slug: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    const inserted = await propsTbl
      .insert({
        agency_id: agencyId,
        source: "manual",
        external_id: overrides.externalReference,
        slug,
        status: "available",
        ...commonFields,
      })
      .select("id, slug")
      .maybeSingle();

    if (inserted.error) return { ok: false, error: inserted.error.message };
    if (!inserted.data) return { ok: false, error: "insert_no_row" };
    propertyId = inserted.data.id;
    resultSlug = inserted.data.slug;
  }

  // Insertar filas de foto con las URLs de ORIGEN (rápido).
  if (sources.length > 0) {
    const photoRows = sources.map((url, idx) => ({
      property_id: propertyId,
      // La portada (idx 0) ya está re-alojada en nuestro storage; el resto van
      // con su URL de origen hasta que el re-alojado de fondo las sustituya.
      url: idx === 0 ? (coverUrl ?? url) : url,
      position: idx,
      is_cover: idx === 0,
    }));
    const photosTbl = supabase.from("property_photos") as unknown as {
      insert: (
        rows: Array<Record<string, unknown>>,
      ) => Promise<{ error: { message: string } | null }>;
    };
    const photosRes = await photosTbl.insert(photoRows);
    if (photosRes.error) {
      return {
        ok: true,
        propertyId,
        slug: resultSlug,
        photosProcessed: 0,
      };
    }
  }

  // Re-alojado en SEGUNDO PLANO (sin await): la respuesta vuelve ya. En pm2 el
  // proceso sigue vivo y completa la descarga/optimización de las fotos.
  //
  // NOTA: el borrado dinámico de marca (cleanDynamicWatermark) NO se ejecuta
  // automáticamente. Con pocas fotos o sin marca real, la detección puede fallar
  // y destrozar las fotos (le pasó a un anuncio sin marca de Vip Consultores).
  // Se ejecuta SOLO a mano sobre anuncios concretos cuya agencia sí marca las
  // fotos (scripts/wmrm/clean-property-watermark.sh <slug>).
  void rehostPhotosInBackground({
    propertyId,
    agencySlug,
    externalId: overrides.externalReference,
    sources,
  }).catch(() => {});

  return {
    ok: true,
    propertyId,
    slug: resultSlug,
    photosProcessed: sources.length,
  };
}
