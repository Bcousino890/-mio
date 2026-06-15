import "server-only";
import { createClient } from "../server";
import type {
  AgencyPartnershipRow,
  AgencyRow,
  AgencyWithStats,
} from "../row-types";

export type { AgencyPartnershipRow, AgencyRow, AgencyWithStats };

export async function getAgencies() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agencies")
    .select("*, agency_partnerships(*)")
    .order("name");

  if (error) throw error;
  return data;
}

export async function getAgenciesWithStats(): Promise<AgencyWithStats[]> {
  const supabase = await createClient();

  const [agenciesResult, propertiesResult] = await Promise.all([
    supabase
      .from("agencies")
      .select("*, agency_partnerships(*)")
      .order("name"),
    supabase
      .from("properties")
      .select("agency_id, operation")
      .is("archived_at", null),
  ]);

  if (agenciesResult.error) throw agenciesResult.error;
  if (propertiesResult.error) throw propertiesResult.error;

  const agencies = (agenciesResult.data ?? []) as unknown as Array<
    AgencyRow & { agency_partnerships: AgencyPartnershipRow[] | null }
  >;
  const propertyRows = (propertiesResult.data ?? []) as unknown as Array<{
    agency_id: string | null;
    operation: "rent" | "sale";
  }>;

  const counts = new Map<string, { rent: number; sale: number }>();
  for (const p of propertyRows) {
    if (!p.agency_id) continue;
    const c = counts.get(p.agency_id) ?? { rent: 0, sale: 0 };
    if (p.operation === "rent") c.rent++;
    else if (p.operation === "sale") c.sale++;
    counts.set(p.agency_id, c);
  }

  return agencies.map((a) => ({
    ...a,
    rent_count: counts.get(a.id)?.rent ?? 0,
    sale_count: counts.get(a.id)?.sale ?? 0,
  }));
}

export async function getAgencyBySlug(slug: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agencies")
    .select("*, agency_partnerships(*)")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  // Supabase devuelve un objeto único cuando la FK lleva `unique`. Conservamos
  // ambos shapes en el tipo para que el adapter pueda lidiar con ello.
  return data as
    | (AgencyRow & {
        agency_partnerships:
          | AgencyPartnershipRow
          | AgencyPartnershipRow[]
          | null;
      })
    | null;
}

export async function getAgencyProperties(agencyId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .select(
      "id, slug, title, external_id, operation, zone, bedrooms, bathrooms, price, updated_at, cover_photo_url, square_meters, status, features, features_manual, description",
    )
    .eq("agency_id", agencyId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    // Antes 20: en Portales externos (pisos manuales/propios) hay que poder
    // verlos TODOS para encontrar uno concreto. El buscador de la tabla filtra
    // sobre este conjunto, así que cargamos un máximo generoso.
    .limit(500);
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    slug: string;
    title: string;
    external_id: string | null;
    operation: "rent" | "sale";
    zone: string;
    bedrooms: number;
    bathrooms: number;
    price: number;
    updated_at: string;
    cover_photo_url: string | null;
    square_meters: number | null;
    status: "available" | "reserved" | "rented" | "sold" | "draft";
    features: string[] | null;
    features_manual: string[] | null;
    description: string | null;
  }>;
}
