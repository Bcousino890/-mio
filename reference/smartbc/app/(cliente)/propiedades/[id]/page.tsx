import { notFound } from "next/navigation";
import { PropertyDetail } from "./property-detail";
import { propertyRowToClientProperty } from "@/lib/db/adapters";
import { getFavoriteSlugs } from "@/lib/db/queries/favorites";
import { getPropertyBySlug } from "@/lib/db/queries/properties";
import { getCurrentUser } from "@/lib/db/queries/session";
import { getOrComputePropertyCoords } from "@/lib/geo/geocode";

export const dynamic = "force-dynamic";

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [row, user] = await Promise.all([
    getPropertyBySlug(id),
    getCurrentUser(),
  ]);
  if (!row) notFound();
  // Geocoding cacheado: si la propiedad aún no tiene coords (caso típico
  // en pisos sindicados antes de su primera visita), las calculamos y
  // guardamos. Sin esto, el mapa y la tarjeta de universidades no
  // aparecen en pisos recién sincronizados.
  const typedRow = row as unknown as {
    id: string;
    address: string | null;
    zone: string;
    latitude: number | null;
    longitude: number | null;
  };
  const coords = await getOrComputePropertyCoords({
    propertyId: typedRow.id,
    address: typedRow.address,
    zone: typedRow.zone,
    cachedLat: typedRow.latitude,
    cachedLng: typedRow.longitude,
  });
  const property = propertyRowToClientProperty(row);
  if (coords) {
    property.latitude = coords.lat;
    property.longitude = coords.lng;
  }
  const favoriteSlugs = user ? await getFavoriteSlugs(user.id) : [];
  const isFavorite = favoriteSlugs.includes(property.id);
  return <PropertyDetail property={property} isFavorite={isFavorite} />;
}
