import "server-only";
import { createClient } from "@supabase/supabase-js";
import { extractFromUrl } from "@/lib/sync/import-by-link";
import { fetchViaCurl } from "@/lib/sync/import-by-link/fetch-via-curl";
import {
  fetchIdealistaPhoneViaAjax,
  normalizeSpanishPhone,
} from "@/lib/sync/particulares/idealista-advertiser-detector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800; // ~600 fichas × ~1s + márgenes

// Tipo laxo para el cliente Supabase (evita fricción con los genéricos del
// SDK; ya usamos casts puntuales para las operaciones).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

// Búsquedas base de Idealista: todo Madrid capital, venta y alquiler.
// Ordenadas por fecha de publicación descendente, así cada run captura los
// particulares MÁS RECIENTES. El cron corre cada hora desde el VPS y va
// acumulando los anuncios nuevos de toda la ciudad (estrategia incremental:
// el histórico completo son ~30k fichas, inviable de golpe). Para un backfill
// de N páginas recientes, subir PARTICULARES_MAX_PAGES y disparar el script
// de backfill manualmente.
const SEARCH_BASES = [
  // Madrid provincia (no solo capital) - todas las viviendas
  // El scraper filtra profesionales en el código, capturando solo particulares
  "https://www.idealista.com/venta-viviendas/madrid-provincia/",
  "https://www.idealista.com/alquiler-viviendas/madrid-provincia/",
];

// Páginas por listado y por run. 2 listados (venta + alquiler) × 5 páginas
// × 30 anuncios = ~300 fichas/run máx. Ordenadas por fecha reciente: captura
// las novedades de cada listado en cada run. Para un backfill, subir
// PARTICULARES_MAX_PAGES (ej. 80) y disparar manualmente una vez.
const MAX_PAGES = Number.parseInt(
  process.env.PARTICULARES_MAX_PAGES ?? "5",
  10,
);

// Idealista pagina con `/pagina-N.htm` en el path (la página 1 es la base).
// Rango [fromPage, toPage] para poder hacer el backfill por tramos (un
// request HTTP no aguanta miles de fichas — el script de backfill llama
// con tramos pequeños).
function buildSearchUrls(fromPage: number, toPage: number): string[] {
  const urls: string[] = [];
  const sort = "?ordenado-por=fecha-publicacion-desc";
  for (const base of SEARCH_BASES) {
    for (let page = fromPage; page <= toPage; page++) {
      urls.push(page === 1 ? `${base}${sort}` : `${base}pagina-${page}.htm${sort}`);
    }
  }
  return urls;
}

// ─── Upsert preservando historial ────────────────────────────────────────────
// Lógica: si ya existe en BD → actualiza datos frescos + reactiva si estaba
// dado de baja + trackea cambios de precio. Si es nuevo → inserta completo.
// Nunca borra datos. detected_at nunca se sobreescribe.

type ParticularPayload = {
  external_id: string;
  source_url: string;
  owner_name: string | null;
  contact_name: string | null;
  zone: string | null;
  address: string | null;
  phone_confidence: "high" | "medium" | "low" | null;
  price: number | null;
  operation: "rent" | "sale" | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_meters: number | null;
  description: string | null;
  features: string[];
  photos: Array<{ url: string; alt?: string }>;
  advertiser_type: string;
  is_ad_professional: boolean | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  floor_plan_url: string | null;
  video_url: string | null;
};

// ─── Degradación elegante para migraciones 0035/0036 ─────────────────────────
// Las columnas `address`/`phone_confidence` (0035) y `has_floor_plan`/
// `floor_plan_url`/`has_video`/`video_url` (0036) pueden NO estar aplicadas
// todavía en el VPS (se aplican con psql en el post-deploy). Si el
// insert/update falla por columna inexistente, reintenta UNA vez la misma
// operación sin esas claves.

const MIGRATION_0035_COLUMNS = [
  "address",
  "phone_confidence",
  "has_floor_plan",
  "floor_plan_url",
  "has_video",
  "video_url",
] as const;

function isMissing0035ColumnError(error: { message?: string } | null | undefined): boolean {
  const msg = error?.message ?? "";
  if (!/column|does not exist|schema cache/i.test(msg)) return false;
  return MIGRATION_0035_COLUMNS.some((col) => msg.includes(col));
}

// `data` es laxo (any) por la misma razón que SupabaseLike: los genéricos del
// SDK no aportan aquí y ya casteamos puntualmente donde hace falta.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseResult = { error: { message?: string } | null; data?: any };

async function withMigration0035Fallback<T extends SupabaseResult>(
  values: Record<string, unknown>,
  run: (values: Record<string, unknown>) => PromiseLike<T>,
): Promise<T> {
  const first = await run(values);
  if (first.error && isMissing0035ColumnError(first.error)) {
    console.warn(
      "[cron-particulares] Migración 0035 no aplicada — reintentando sin address/phone_confidence",
    );
    const stripped = { ...values };
    for (const col of MIGRATION_0035_COLUMNS) delete stripped[col];
    return run(stripped);
  }
  return first;
}

async function upsertParticular(
  supabase: SupabaseLike,
  payload: ParticularPayload,
): Promise<boolean> {
  const now = new Date().toISOString();

  // Buscar si ya existe (activo o no). Incluimos todos los campos necesarios
  // para detectar cambios: price, photos count, description, phone.
  // select("*") a propósito: incluye columnas de migraciones nuevas (0035/
  // 0036) sin romper si aún no están aplicadas en el VPS.
  const { data: existing } = await supabase
    .from("particulares")
    .select("*")
    .eq("external_id", payload.external_id)
    .maybeSingle();

  if (existing) {
    const priceChanged = payload.price !== null && existing.price !== payload.price;
    const wasInactive = !existing.is_active;
    // Phone logic:
    // - phoneAdded: no phone before, now we have one (HIGH/MEDIUM confidence)
    // - phoneChanged: had a phone, new scrape found a DIFFERENT valid phone → replace it
    // - If new scrape returns null (LOW/no confidence), keep the existing phone intact
    const phoneAdded = !existing.phone && !!payload.phone;
    const phoneChanged = !!existing.phone && !!payload.phone && existing.phone !== payload.phone;
    // Resolve the phone to persist: prefer new HIGH/MEDIUM phone over existing;
    // fall back to existing when new scrape found nothing (payload.phone is null).
    const resolvedPhone = payload.phone ?? existing.phone;
    const existingPhotoCount = Array.isArray(existing.photos) ? existing.photos.length : 0;
    const newPhotoCount = payload.photos.length;
    const photoCountChanged = newPhotoCount !== existingPhotoCount && newPhotoCount > 0;
    // Multimedia nueva: el anuncio ganó plano o vídeo desde el último scrape.
    const floorPlanAdded = !existing.has_floor_plan && !!payload.floor_plan_url;
    const videoAdded = !existing.has_video && !!payload.video_url;

    // Actualizar con datos frescos. detected_at NO se toca.
    // Preservar phone existente si el nuevo scrape no lo encontró.
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
      phone: resolvedPhone,
      // Sin teléfono real extraído (validado formato español) → el anuncio
      // solo se puede contactar por el chat del portal.
      chat_only: !resolvedPhone,
      latitude: payload.latitude,
      longitude: payload.longitude,
      advertiser_type: payload.advertiser_type,
      is_ad_professional: payload.is_ad_professional,
      // Plano/vídeo: si el scrape nuevo no los trajo, conservar lo guardado
      // (no degradar un anuncio que sí los tenía por un HTML incompleto).
      has_floor_plan: !!payload.floor_plan_url || !!existing.has_floor_plan,
      floor_plan_url: payload.floor_plan_url ?? existing.floor_plan_url ?? null,
      has_video: !!payload.video_url || !!existing.has_video,
      video_url: payload.video_url ?? existing.video_url ?? null,
      is_active: true,
      taken_down_at: null,
      updated_at: now,
    };
    // Confianza del teléfono: solo se escribe cuando el scrape nuevo trajo
    // teléfono (análogo a resolvedPhone). Si se conserva el phone existente
    // (payload.phone null), NO tocamos phone_confidence para no machacar la
    // confianza guardada con null.
    if (payload.phone) {
      updateValues.phone_confidence = payload.phone_confidence;
    }

    const { error } = await withMigration0035Fallback(updateValues, (values) =>
      supabase.from("particulares").update(values).eq("id", existing.id),
    );

    if (error) {
      console.error("[cron-particulares] Error actualizando:", error);
      return false;
    }

    // Registrar todos los cambios detectados en el historial
    const changesToInsert = [];

    if (priceChanged && payload.price !== null) {
      const priceDirection = payload.price > (existing.price ?? 0) ? "price_up" : "price_down";
      changesToInsert.push({
        particular_id: existing.id,
        change_type: priceDirection,
        old_value: { price: existing.price },
        new_value: { price: payload.price },
        changed_at: now,
      });
    }
    if (wasInactive) {
      changesToInsert.push({
        particular_id: existing.id,
        change_type: "reactivated",
        old_value: null,
        new_value: { reactivated_at: now },
        changed_at: now,
      });
    }
    if (phoneAdded) {
      changesToInsert.push({
        particular_id: existing.id,
        change_type: "phone_added",
        old_value: null,
        new_value: { phone: payload.phone },
        changed_at: now,
      });
    }
    if (phoneChanged) {
      changesToInsert.push({
        particular_id: existing.id,
        change_type: "phone_changed",
        old_value: { phone: existing.phone },
        new_value: { phone: payload.phone },
        changed_at: now,
      });
    }
    if (photoCountChanged) {
      changesToInsert.push({
        particular_id: existing.id,
        change_type: "photo_count_change",
        old_value: { count: existingPhotoCount },
        new_value: { count: newPhotoCount },
        changed_at: now,
      });
    }
    if (floorPlanAdded) {
      changesToInsert.push({
        particular_id: existing.id,
        change_type: "floor_plan_added",
        old_value: null,
        new_value: { floor_plan_url: payload.floor_plan_url },
        changed_at: now,
      });
    }
    if (videoAdded) {
      changesToInsert.push({
        particular_id: existing.id,
        change_type: "video_added",
        old_value: null,
        new_value: { video_url: payload.video_url },
        changed_at: now,
      });
    }

    if (changesToInsert.length > 0) {
      await supabase.from("particulares_changes").insert(changesToInsert);
    }

    if (wasInactive) {
      console.log(`[cron-particulares] Reactivado: ${payload.external_id}`);
    }

    return true;
  }

  // Nuevo registro — insertar con detected_at = ahora.
  // El trigger trg_particulares_reference genera particular_reference automáticamente.
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
    phone_confidence: payload.phone_confidence,
    chat_only: !payload.phone,
    latitude: payload.latitude,
    longitude: payload.longitude,
    advertiser_type: payload.advertiser_type,
    is_ad_professional: payload.is_ad_professional,
    has_floor_plan: !!payload.floor_plan_url,
    floor_plan_url: payload.floor_plan_url,
    has_video: !!payload.video_url,
    video_url: payload.video_url,
    is_active: true,
    detected_at: now,
    updated_at: now,
  };

  const { data: inserted, error } = await withMigration0035Fallback(
    insertValues,
    (values) =>
      supabase
        .from("particulares")
        .insert(values)
        .select("id, particular_reference")
        .single(),
  );

  if (error) {
    console.error("[cron-particulares] Error insertando:", error);
    return false;
  }

  // Registrar el evento de alta en el historial
  if (inserted?.id) {
    await supabase.from("particulares_changes").insert({
      particular_id: inserted.id,
      change_type: "new_listing",
      old_value: null,
      new_value: {
        particular_reference: inserted.particular_reference,
        price: payload.price,
        zone: payload.zone,
        phone: payload.phone,
      },
      changed_at: now,
    });
  }

  return true;
}

async function scrapeMadridParticulares(fromPage: number, toPage: number) {
  // Inicializar cliente dentro de la función para evitar errores en build time
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const results = {
    processed: 0,
    particulares: 0,
    profesionales: 0,
    unknown: 0,
    errors: 0,
  };

  try {
    // Obtener listado de URLs de propiedades
    const propertyUrls = await extractPropertyUrlsFromSearch(fromPage, toPage);

    for (const url of propertyUrls) {
      try {
        // Extraer datos + detectar tipo de anunciante
        const extracted = await extractFromUrl(url);

        if (!extracted.ok) {
          results.errors++;
          continue;
        }

        const { preview } = extracted;
        const advertiserInfo = preview.advertiserInfo;

        // Solo guardar particulares y anunciantes desconocidos (posibles
        // particulares en portales como Fotocasa que no exponen el flag
        // isProfessional en el HTML servido al scraper).
        // Los profesionales confirmados se descartan.
        if (advertiserInfo?.advertiser_type === "professional") {
          results.profesionales++;
          continue;
        }
        // "unknown" se guarda igualmente — significa que no se pudo confirmar
        // si es profesional, pero tampoco se confirmó que lo sea.
        // Mejor guardar y filtrar manualmente que perder particulares válidos.
        // (Se cuenta tras el guardado para que processed = particulares +
        // profesionales + unknown + errors, sin dobles conteos.)

        // Fallback "Ver teléfono": si el HTML no trajo teléfono, intentar
        // los endpoints AJAX de contacto de Idealista (el teléfono de muchos
        // anuncios solo se revela vía AJAX al pulsar el botón).
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

        // Guardar en BD preservando detected_at y rastreando cambios
        const saved = await upsertParticular(supabase, {
          external_id: preview.externalReference,
          source_url: url,
          owner_name: preview.title ?? null,
          contact_name: advertiserInfo?.contact_name ?? null,
          zone: preview.zone ?? null,
          address: preview.address ?? null,
          price: preview.price ?? null,
          operation: (preview.operation as "rent" | "sale") ?? null,
          bedrooms: preview.bedrooms ?? null,
          bathrooms: preview.bathrooms ?? null,
          square_meters: preview.squareMeters ?? null,
          description: preview.description ?? null,
          features: preview.features ?? [],
          photos: (preview.photos ?? []) as Array<{ url: string; alt?: string }>,
          advertiser_type: advertiserInfo?.advertiser_type ?? "unknown",
          is_ad_professional: advertiserInfo?.is_ad_professional ?? null,
          phone,
          phone_confidence: phoneConfidence,
          latitude: preview.latitude ?? null,
          longitude: preview.longitude ?? null,
          floor_plan_url: preview.floorPlanUrl ?? null,
          video_url: preview.videoUrl ?? null,
        });

        if (!saved) {
          results.errors++;
        } else if (advertiserInfo?.advertiser_type === "unknown") {
          results.unknown++;
        } else {
          results.particulares++;
        }
      } catch (err) {
        console.error("[cron-particulares] Error procesando URL:", err);
        results.errors++;
      }

      results.processed++;
    }

    // Detección de bajas: revisita los activos vistos hace más tiempo y
    // marca como inactivos los que ya no existen en Idealista (404 = el
    // particular retiró el anuncio: vendió, alquiló o fichó con agencia).
    // Los activos que siguen vivos refrescan su updated_at.
    const removed = await markStaleListingsInactive(supabase);
    (results as Record<string, number>).bajas = removed;

    // Normalización de teléfonos heredados: reescribe a +34XXXXXXXXX los
    // phones guardados con otro formato (sin prefijo, con espacios…).
    // Idempotente y barato: tras la primera pasada quedan 0 pendientes.
    const normalized = await normalizeStoredPhones(supabase);
    (results as Record<string, number>).telefonos_normalizados = normalized;

    // Backfill de teléfonos ocultos tras "Ver teléfono": cada hora revisa
    // un lote de activos SIN teléfono (los menos revisados primero) llamando
    // solo al endpoint AJAX de contacto (barato: sin re-descargar la ficha).
    // Con ~50/hora se cubre todo el stock en <1 día y de ahí en adelante
    // cada anuncio sin teléfono se re-verifica continuamente, captando los
    // teléfonos que los propietarios añaden después de publicar.
    const found = await backfillPhonesViaAjax(supabase, 50);
    (results as Record<string, number>).telefonos_encontrados = found;

    return results;
  } catch (error) {
    console.error("[cron-particulares] Error general:", error);
    throw error;
  }
}

// Revisa anuncios activos sin teléfono llamando SOLO al endpoint AJAX de
// contacto de Idealista (el del botón "Ver teléfono") — sin re-descargar la
// ficha completa. Los menos revisados primero (updated_at asc); cada anuncio
// procesado refresca su updated_at para rotar al final de la cola, tenga o
// no teléfono. Si aparece teléfono → guardar normalizado + historial.
async function backfillPhonesViaAjax(
  supabase: SupabaseLike,
  limit: number,
): Promise<number> {
  const { data, error } = await supabase
    .from("particulares")
    .select("id, source_url")
    .eq("is_active", true)
    .is("phone", null)
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error || !data || data.length === 0) return 0;

  let found = 0;
  for (const row of data as Array<{ id: string; source_url: string }>) {
    const now = new Date().toISOString();
    const adId = row.source_url.match(/\/inmueble\/(\d+)/)?.[1];
    if (!adId) {
      await supabase
        .from("particulares")
        .update({ updated_at: now })
        .eq("id", row.id);
      continue;
    }

    try {
      const ajax = await fetchIdealistaPhoneViaAjax(adId, {
        proxyUrl: process.env.SMARTPROXY_URL,
      });
      const values: Record<string, unknown> = ajax.phone
        ? {
            phone: ajax.phone,
            phone_confidence: ajax.phone_confidence,
            chat_only: false,
            updated_at: now,
          }
        : { chat_only: true, updated_at: now };

      const { error: updErr } = await withMigration0035Fallback(
        values,
        (v) => supabase.from("particulares").update(v).eq("id", row.id),
      );
      if (!updErr && ajax.phone) {
        found++;
        await supabase.from("particulares_changes").insert({
          particular_id: row.id,
          change_type: "phone_added",
          old_value: null,
          new_value: { phone: ajax.phone },
          changed_at: now,
        });
      }
    } catch (err) {
      console.warn(`[cron-particulares] backfill teléfono ${adId}:`, err);
    }
  }
  if (found > 0) {
    console.log(`[cron-particulares] teléfonos encontrados vía AJAX: ${found}`);
  }
  return found;
}

// Reescribe al formato canónico +34XXXXXXXXX los teléfonos ya guardados que
// no lo tengan (datos previos a la normalización del detector). Los valores
// no normalizables (no son un teléfono español válido) se dejan intactos.
async function normalizeStoredPhones(supabase: SupabaseLike): Promise<number> {
  let normalized = 0;
  const BATCH = 1000;
  // Siempre re-consulta desde 0: al normalizar, las filas salen del filtro
  // `not like '+34%'` y un offset incremental saltaría pendientes. Si una
  // pasada no actualiza nada (solo quedan valores no normalizables), corta.
  for (let pass = 0; pass < 50; pass++) {
    const { data, error } = await supabase
      .from("particulares")
      .select("id, phone")
      .not("phone", "is", null)
      .not("phone", "like", "+34%")
      .range(0, BATCH - 1);
    if (error || !data || data.length === 0) break;

    let updatedInPass = 0;
    for (const row of data as Array<{ id: string; phone: string }>) {
      const canonical = normalizeSpanishPhone(row.phone);
      if (canonical && canonical !== row.phone) {
        const { error: updErr } = await supabase
          .from("particulares")
          .update({ phone: canonical })
          .eq("id", row.id);
        if (!updErr) {
          normalized++;
          updatedInPass++;
        }
      }
    }
    if (updatedInPass === 0 || data.length < BATCH) break;
  }
  if (normalized > 0) {
    console.log(`[cron-particulares] teléfonos normalizados a +34: ${normalized}`);
  }
  return normalized;
}

// Revisa hasta `limit` anuncios activos (los menos refrescados) y marca
// inactivos los que devuelven 404 — preservando TODOS los datos.
// 404 = el particular retiró el anuncio (vendió, alquiló o fichó agencia).
// Los datos (fotos, precio, contacto, descripción) se conservan íntegros
// para poder consultarlos o reactivarlos si el anuncio vuelve.
async function markStaleListingsInactive(
  supabase: SupabaseLike,
  limit = 40,
): Promise<number> {
  const { data } = await supabase
    .from("particulares")
    .select("id, source_url")
    .eq("is_active", true)
    .order("updated_at", { ascending: true })
    .limit(limit);

  let removed = 0;
  const now = new Date().toISOString();

  for (const row of (data ?? []) as Array<{ id: string; source_url: string }>) {
    const res = await fetchViaCurl(row.source_url, WHATSAPP_UA, {
      proxyUrl: process.env.SMARTPROXY_URL,
    });

    if (!res.ok && res.status === 404) {
      // Baja confirmada: marcar inactivo + registrar taken_down_at.
      // Todos los demás campos (fotos, precio, contacto…) se conservan.
      await supabase
        .from("particulares")
        .update({ is_active: false, taken_down_at: now, updated_at: now })
        .eq("id", row.id);

      // Log en histórico de cambios
      await supabase.from("particulares_changes").insert({
        particular_id: row.id,
        change_type: "deleted",
        old_value: null,
        new_value: { taken_down_at: now },
        changed_at: now,
      });

      removed++;
      console.log(`[cron-particulares] Baja: ${row.source_url}`);
    } else if (res.ok) {
      // Sigue activo: refrescar updated_at para no revisarlo en cada run.
      await supabase
        .from("particulares")
        .update({ updated_at: now })
        .eq("id", row.id);
    }
    // res.ok=false pero ≠404 (timeout, error red…): no tocar, reintentar otro run
  }

  console.log(`[cron-particulares] bajas detectadas: ${removed}`);
  return removed;
}

// UA de WhatsApp: DataDome lo deja pasar (whitelist por los previews de
// links compartidos por WhatsApp). Permite scrapear listados y fichas de
// Idealista con un fetch directo, sin proxy ni navegador.
const WHATSAPP_UA = "WhatsApp/2.23.20.0";

async function extractPropertyUrlsFromSearch(
  fromPage: number,
  toPage: number,
): Promise<string[]> {
  const seen = new Set<string>();

  for (const searchUrl of buildSearchUrls(fromPage, toPage)) {
    // Vía curl con UA WhatsApp + proxy residencial — pasa DataDome (el TLS
    // de undici no, y la IP del datacenter se quema sin el proxy).
    const res = await fetchViaCurl(searchUrl, WHATSAPP_UA, {
      proxyUrl: process.env.SMARTPROXY_URL,
    });
    if (!res.ok) {
      console.warn(
        `[cron-particulares] listado ${searchUrl} -> ${res.reason}`,
      );
      continue;
    }

    // Extraer IDs de propiedades del HTML y normalizar a URL canónica.
    const matches = res.html.matchAll(/\/inmueble\/(\d+)/g);
    for (const match of matches) {
      if (match[1]) {
        seen.add(`https://www.idealista.com/inmueble/${match[1]}/`);
      }
    }
  }

  return Array.from(seen);
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Rango de páginas opcional vía query (?fromPage=1&toPage=3) para el
  // backfill por tramos. Por defecto usa [1, MAX_PAGES] (modo cron normal).
  const { searchParams } = new URL(req.url);
  const fromPage = Math.max(
    1,
    Number.parseInt(searchParams.get("fromPage") ?? "1", 10) || 1,
  );
  const toPage = Math.max(
    fromPage,
    Number.parseInt(searchParams.get("toPage") ?? String(MAX_PAGES), 10) ||
      MAX_PAGES,
  );

  try {
    console.log(
      `[cron-particulares] Iniciando scraping páginas ${fromPage}-${toPage}`,
    );
    const results = await scrapeMadridParticulares(fromPage, toPage);
    return Response.json({
      ok: true,
      timestamp: new Date().toISOString(),
      pages: { fromPage, toPage },
      results,
    });
  } catch (error) {
    console.error("[cron-particulares] Error:", error);
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
