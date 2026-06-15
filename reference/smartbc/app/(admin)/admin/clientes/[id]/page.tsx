import { notFound } from "next/navigation";
import { clientRowToAdminClient } from "@/lib/db/adapters";
import { getClientById } from "@/lib/db/queries/clients";
import { ClientFichaView } from "./client-ficha-view";

export const dynamic = "force-dynamic";

export default async function ClientFichaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rowData = await getClientById(id);
  if (!rowData) notFound();

  // getClientById retorna datos con count embebido distinto al getClients.
  // Adaptamos manualmente las relaciones para reusar el adaptador.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = rowData as any;
  const adapted = clientRowToAdminClient({
    ...row,
    favorites: row.favorites
      ? [{ count: (row.favorites as Array<{ property_id: string }>).length }]
      : [{ count: 0 }],
    visit_requests: row.visit_requests
      ? [{ count: (row.visit_requests as Array<unknown>).length }]
      : [{ count: 0 }],
    client_tag_assignments: row.client_tag_assignments ?? [],
  } as Parameters<typeof clientRowToAdminClient>[0]);

  // Datos raw para la ficha. Las rutas de admin de propiedades usan SLUG
  // (/admin/propiedades/[slug]), no el UUID, así que traemos el slug/título
  // de la propiedad embebidos en la query.
  type PropertyRef = { slug: string; title: string } | null;
  const rawFavorites = (
    row.favorites as Array<{ property_id: string; properties: PropertyRef }> | null
  ) ?? [];
  const rawVisits = (
    row.visit_requests as Array<{
      id: string;
      property_id: string;
      requested_at: string;
      status: string;
      properties: PropertyRef;
    }> | null
  ) ?? [];

  return (
    <ClientFichaView
      client={adapted}
      favorites={rawFavorites.map((f) => ({
        id: f.property_id,
        slug: f.properties?.slug ?? null,
        title: f.properties?.title ?? null,
      }))}
      visits={rawVisits.map((v) => ({
        id: v.id,
        property_id: v.property_id,
        requested_at: v.requested_at,
        status: v.status,
        propertyTitle: v.properties?.title ?? null,
        propertySlug: v.properties?.slug ?? null,
      }))}
    />
  );
}
