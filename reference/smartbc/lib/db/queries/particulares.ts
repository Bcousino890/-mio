import "server-only";
import { createAdminClient } from "../admin";

/**
 * Listado de particulares enriquecido para el panel:
 *  - columnas base del anuncio
 *  - asignación (assigned_to → nombre del asesor)      [migración 0034]
 *  - último contacto registrado (quién/cuándo/cómo)    [migración 0033]
 *  - dirección y confianza del teléfono                [migración 0035]
 *  - plano y vídeo del anuncio                         [migración 0036]
 *
 * Trae TODOS los anuncios sin límite: primero los ACTIVOS (created_at desc)
 * y a continuación los RETIRADOS (is_active = false, taken_down_at desc),
 * fusionados en `rows`. Se pagina internamente por lotes de 1000 contra
 * PostgREST, pero el llamador recibe el conjunto completo. `total` = nº de
 * activos (lo usan las stats del panel).
 *
 * Cada extra degrada con elegancia si su migración aún no está aplicada
 * en el VPS: el listado nunca se rompe.
 */

const BASE_COLUMNS =
  "id, portal, external_id, source_url, zone, price, operation, bedrooms, bathrooms, square_meters, description, photos, features, owner_name, phone, chat_only, latitude, longitude, taken_down_at, detected_at, created_at, is_active";

// Columnas de la migración 0036 (plano + vídeo). Pueden no existir aún en el
// VPS — por eso van en intentos separados (degradación elegante).
const MEDIA_COLUMNS_0036 =
  "has_floor_plan, floor_plan_url, has_video, video_url";

export type EnrichedParticularRow = Record<string, unknown> & {
  id: string;
  assigned_to: string | null;
  assigned_name: string | null;
  last_contact_at: string | null;
  last_contact_by: string | null;
  last_contact_type: string | null;
  contact_count: number;
};

// Trae TODAS las filas de una consulta paginando por lotes de 1000 (PostgREST
// limita las filas por request; con .range() iteramos hasta agotar).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: (from: number, to: number) => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ rows: any[]; error: { message: string } | null }> {
  const BATCH = 1000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [];
  for (let from = 0; ; from += BATCH) {
    const res = await buildQuery(from, from + BATCH - 1);
    if (res.error) return { rows: all, error: res.error };
    const batch = res.data ?? [];
    all.push(...batch);
    if (batch.length < BATCH) break;
  }
  return { rows: all, error: null };
}

export async function getParticularesPage(_offset?: number, _pageSize?: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient() as any;

  // Intentos de más completo a más básico según migraciones aplicadas:
  // 0036 (plano/vídeo) → 0035 (address, phone_confidence) → 0034 (assigned_*)
  // → 0024 (particular_reference) → 0012 (advertiser_type) → base.
  const attempts = [
    `${BASE_COLUMNS}, advertiser_type, address, phone_confidence, particular_reference, assigned_to, assigned_at, ${MEDIA_COLUMNS_0036}`,
    `${BASE_COLUMNS}, advertiser_type, address, phone_confidence, particular_reference, assigned_to, assigned_at`,
    `${BASE_COLUMNS}, advertiser_type, address, phone_confidence, particular_reference`,
    `${BASE_COLUMNS}, advertiser_type, particular_reference, assigned_to, assigned_at`,
    `${BASE_COLUMNS}, advertiser_type, particular_reference`,
    `${BASE_COLUMNS}, advertiser_type`,
    BASE_COLUMNS,
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows: any[] = [];
  let total = 0;
  let lastError: { message: string } | null = null;
  for (const cols of attempts) {
    // ACTIVOS: todos, sin límite (por lotes de 1000 para sortear el tope
    // de filas por request de PostgREST).
    const actives = await fetchAllRows((from, to) =>
      supabase
        .from("particulares")
        .select(cols)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .range(from, to),
    );
    if (actives.error) {
      lastError = actives.error;
      continue;
    }
    rows = actives.rows;
    total = actives.rows.length;
    lastError = null;

    // RETIRADOS (mismas columnas): también todos, sin límite, para que el
    // tab "Retirados" del cliente muestre todo lo que hay en la BD.
    const retired = await fetchAllRows((from, to) =>
      supabase
        .from("particulares")
        .select(cols)
        .eq("is_active", false)
        .order("taken_down_at", { ascending: false, nullsFirst: false })
        .range(from, to),
    );
    if (!retired.error) {
      rows = [...rows, ...retired.rows];
    }
    break;
  }
  if (lastError) throw new Error(lastError.message);

  const ids = rows.map((r) => r.id);
  const advisorIds = new Set<string>(
    rows.map((r) => r.assigned_to).filter(Boolean),
  );

  // Último contacto + nº de contactos por anuncio (particulares_contacts).
  const lastContacts = new Map<
    string,
    { advisor_id: string; contact_type: string; contacted_at: string }
  >();
  const contactCounts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: contacts, error: contactsErr } = await supabase
      .from("particulares_contacts")
      .select("particular_id, advisor_id, contact_type, contacted_at")
      .in("particular_id", ids)
      .order("contacted_at", { ascending: false });
    if (!contactsErr) {
      for (const c of contacts ?? []) {
        contactCounts.set(
          c.particular_id,
          (contactCounts.get(c.particular_id) ?? 0) + 1,
        );
        if (!lastContacts.has(c.particular_id)) {
          lastContacts.set(c.particular_id, c);
          advisorIds.add(c.advisor_id);
        }
      }
    }
  }

  // Nombres de los asesores implicados (asignados o que contactaron).
  const names = new Map<string, string>();
  if (advisorIds.size > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", Array.from(advisorIds));
    for (const p of profs ?? []) {
      names.set(p.id, (p.full_name as string) || (p.email as string));
    }
  }

  const enriched: EnrichedParticularRow[] = rows.map((r) => {
    const lc = lastContacts.get(r.id);
    return {
      ...r,
      assigned_to: r.assigned_to ?? null,
      assigned_name: r.assigned_to ? (names.get(r.assigned_to) ?? null) : null,
      last_contact_at: lc?.contacted_at ?? null,
      last_contact_by: lc ? (names.get(lc.advisor_id) ?? null) : null,
      last_contact_type: lc?.contact_type ?? null,
      contact_count: contactCounts.get(r.id) ?? 0,
    };
  });

  return { rows: enriched, total };
}

/** Opciones de staff para el desplegable de asignación. */
export async function getStaffOptions(): Promise<
  Array<{ id: string; name: string }>
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient() as any;
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .in("role", [
      "owner",
      "admin",
      "advisor",
      "agent_junior",
      "agent_senior",
      "agent_admin",
    ])
    .order("full_name");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((p: any) => ({
    id: p.id as string,
    name: (p.full_name as string) || (p.email as string),
  }));
}
