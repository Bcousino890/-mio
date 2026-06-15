import { mockProperties } from "@/lib/mock-properties";
import type { FavoriteEntry, Property } from "@/lib/types";

const extraFavorites: Property[] = [
  {
    id: "fav-malasana",
    title: "Loft en Malasaña",
    zone: "Malasaña",
    city: "Madrid",
    bedrooms: 1,
    bathrooms: 1,
    squareMeters: 70,
    price: 2200,
    stayType: "corta",
    operation: "alquiler",
  },
  {
    id: "fav-retiro",
    title: "Piso reformado en Retiro",
    zone: "Retiro",
    city: "Madrid",
    bedrooms: 3,
    bathrooms: 2,
    squareMeters: 125,
    price: 4500,
    stayType: "larga",
    operation: "alquiler",
    badge: "destacada",
  },
];

export const mockFavorites: FavoriteEntry[] = [
  { property: mockProperties[0] }, // Velázquez
  { property: mockProperties[1] }, // Abascal
  { property: mockProperties[2] }, // Hortaleza ático
  { property: extraFavorites[0] }, // Malasaña
  { property: extraFavorites[1], unavailable: true }, // Retiro — no disponible
];
