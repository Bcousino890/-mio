import "server-only";
import { storedSlugFromShare } from "../../share-slug";
import { createAdminClient } from "../admin";
import { createClient } from "../server";
import type { PropertyFilters, PropertyRow } from "../row-types";

export type { PropertyFilters, PropertyRow };

export async function getProperties(filters: PropertyFilters = {}, limit = 50) {
  const supabase = await createClient();
  let query = supabase
    .from("properties")
    .select(
      "*, agencies(name, slug), property_photos(url, is_cover, position)",
    )
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!filters.includeUnavailable) query = query.eq("status", "available");

  if (filters.operation) query = query.eq("operation", filters.operation);
  if (filters.stay) query = query.eq("stay", filters.stay);
  if (filters.zones?.length) query = query.in("zone", filters.zones);
  if (filters.minPrice !== undefined) query = query.gte("price", filters.minPrice);
  if (filters.maxPrice !== undefined) query = query.lte("price", filters.maxPrice);
  if (filters.minBedrooms !== undefined) query = query.gte("bedrooms", filters.minBedrooms);
  if (filters.maxBedrooms !== undefined) query = query.lte("bedrooms", filters.maxBedrooms);
  if (filters.minBathrooms !== undefined) query = query.gte("bathrooms", filters.minBathrooms);
  if (filters.minSquareMeters !== undefined) query = query.gte("square_meters", filters.minSquareMeters);
  if (filters.availableFrom) query = query.lte("available_from", filters.availableFrom);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getPropertyBySlug(slug: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .select("*, property_photos(*), agencies(name, slug, logo_url)")
    .eq("slug", slug)
    .is("archived_at", null)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// Resuelve un slug viejo a su slug actual usando la tabla `legacy_slugs`.
// Se usa solo cuando el lookup directo falla — los slugs viejos se crearon
// con prefijo de agencia (ej. "level-titulo-3291") antes de neutralizarlos.
export async function resolveLegacySlug(
  oldSlug: string,
): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await (
    supabase.from("legacy_slugs") as unknown as {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          maybeSingle: () => Promise<{
            data: { new_slug: string } | null;
          }>;
        };
      };
    }
  )
    .select("new_slug")
    .eq("old_slug", oldSlug)
    .maybeSingle();
  return data?.new_slug ?? null;
}

// Variante pública para los SmartLinks (/compartir/[slug]). Bypasa la RLS
// con el service role porque el visitante no está autenticado. Solo
// devuelve propiedades NO archivadas para no exponer borradores ni
// retiradas. La privacidad se basa en lo difícil de adivinar del slug.
export async function getPropertyBySlugPublic(slug: string) {
  const supabase = createAdminClient();
  const fetchBy = async (s: string) => {
    const { data, error } = await supabase
      .from("properties")
      .select("*, property_photos(*), agencies(name, slug, logo_url)")
      .eq("slug", s)
      .is("archived_at", null)
      .neq("status", "archived")
      .maybeSingle();
    if (error) throw error;
    return data;
  };
  // Carga videos y planos de property_media. Tolerante a fallos: si la
  // tabla no existe (migración 0016 sin aplicar) devolvemos lista vacía
  // en lugar de tumbar el SmartLink entero.
  const withMedia = async (row: Record<string, unknown>) => {
    try {
      const { data: media, error } = await (supabase as any)
        .from("property_media")
        .select("id, url, file_name, type, storage_path")
        .eq("property_id", row.id)
        .in("type", ["video", "plan"]);
      return { ...row, property_media: error ? [] : (media ?? []) };
    } catch {
      return { ...row, property_media: [] };
    }
  };
  // Exacto: links viejos (sin prefijo) y el propio slug almacenado.
  const exact = await fetchBy(slug);
  if (exact) return withMedia(exact as Record<string, unknown>);
  // URLs nuevas con la referencia delante ("bc0871-{slug}"): quitamos el prefijo.
  const stripped = storedSlugFromShare(slug);
  if (stripped === slug) return null;
  const byStripped = await fetchBy(stripped);
  return byStripped ? withMedia(byStripped as Record<string, unknown>) : null;
}

// Variante para el admin: trae la propiedad por slug incluso si está
// archivada (necesario para la página de edición — el admin tiene que
// poder ver y reactivar propiedades archivadas).
export async function getPropertyBySlugForAdmin(slug: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .select(
      "*, property_photos(url, alt, position, is_cover), agencies(id, name, slug, logo_url)",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  // Cargar videos y planos de property_media
  const { data: media } = await (supabase as any)
    .from("property_media")
    .select("id, url, file_name, type, storage_path")
    .eq("property_id", (data as any).id)
    .in("type", ["video", "plan"]);

  return { ...(data as object), property_media: media ?? [] };
}
