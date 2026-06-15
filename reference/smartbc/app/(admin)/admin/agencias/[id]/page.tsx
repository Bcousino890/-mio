import { notFound } from "next/navigation";
import { AgencyDetailView } from "./agency-detail-view";
import { agencyDetailFromDb, minutesSince } from "@/lib/db/adapters";
import {
  getAgencyBySlug,
  getAgencyProperties,
} from "@/lib/db/queries/agencies";
import { extractFloor } from "@/lib/floor";
import { getAgencyDetail } from "@/lib/mock-agency-details";
import type { AgencyPropertyRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AgencyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dbAgency = await getAgencyBySlug(id);
  if (!dbAgency) notFound();

  // Las comisiones, umbrales y contacto vienen ya de BD (vía agency_partnerships
  // y agencies). El mock se mantiene como fallback solo para los campos que
  // aún no están modelados (condiciones del acuerdo, dirección).
  const fallback = getAgencyDetail(id) ?? getAgencyDetail("level");
  if (!fallback) notFound();

  const propertyRows = await getAgencyProperties(dbAgency.id);
  const properties: AgencyPropertyRow[] = propertyRows.map((p) => ({
    id: p.slug,
    title: p.title,
    reference: p.external_id ?? p.slug.toUpperCase(),
    operation: p.operation === "rent" ? "alquiler" : "venta",
    zone: p.zone,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    price: Number(p.price),
    squareMeters: p.square_meters,
    status: p.status,
    floor: extractFloor(
      [...(p.features ?? []), ...(p.features_manual ?? [])],
      p.title,
      p.description,
    ),
    lastUpdateMinutes: minutesSince(p.updated_at),
    coverPhotoUrl: p.cover_photo_url ?? null,
  }));

  const agencyBase = agencyDetailFromDb(dbAgency, fallback);
  const agency = { ...agencyBase, properties };
  return <AgencyDetailView agency={agency} />;
}
