import { propertyRowToClientProperty } from "@/lib/db/adapters";
import { getFavoriteSlugs } from "@/lib/db/queries/favorites";
import { getProperties } from "@/lib/db/queries/properties";
import { getCurrentUser } from "@/lib/db/queries/session";
import { PropiedadesClient } from "./propiedades-client";

export const dynamic = "force-dynamic";

export default async function PropiedadesPage() {
  const [rows, user] = await Promise.all([
    // Límite alto para que el cliente vea TODO el catálogo sindicado (cientos
    // de pisos de las agencias), no solo los 100 más recientes. El filtrado
    // se hace en cliente sobre este conjunto.
    getProperties({ includeUnavailable: false }, 2000),
    getCurrentUser(),
  ]);
  const properties = rows.map(propertyRowToClientProperty);
  const favoriteSlugs = user ? await getFavoriteSlugs(user.id) : [];
  return (
    <PropiedadesClient
      properties={properties}
      favoriteSlugs={favoriteSlugs}
    />
  );
}
