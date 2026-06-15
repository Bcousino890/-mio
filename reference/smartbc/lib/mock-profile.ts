import type { ClientProfile } from "@/lib/types";

export const mockProfile: ClientProfile = {
  firstName: "María",
  lastName: "Álvarez",
  email: "maria.alvarez@example.com",
  phone: "+34 611 222 333",
  preferredLanguage: "es",
  memberSince: "Marzo 2024",
  preferences: {
    bedrooms: 2,
    budgetMin: 3000,
    budgetMax: 5000,
    stayType: "corta",
    operation: "alquiler",
    preferredZones: ["Salamanca", "Chamberí", "Justicia"],
  },
  shopperTagKeys: [
    "perfil.tags.worker",
    "perfil.tags.shortStay",
    "perfil.tags.zoneSalamanca",
    "perfil.tags.budgetMid",
  ],
};
