import type { Agency } from "@/lib/types";

// `mockAgencies` se mantiene como dataset base para `mock-agency-details.ts`,
// que aún alimenta el detalle de agencia hasta que el schema modele contactos
// y condiciones por agencia.
export const mockAgencies: Agency[] = [
  {
    id: "level",
    name: "Level Real Estate",
    city: "Madrid",
    initials: "LV",
    rentCount: 24,
    saleCount: 15,
    lastUpdateMinutes: 2,
  },
  {
    id: "alvora",
    name: "Álvora Capital Properties",
    city: "Madrid",
    initials: "AC",
    rentCount: 18,
    saleCount: 12,
    lastUpdateMinutes: 3,
  },
  {
    id: "de-salas",
    name: "De Salas Luxury Homes",
    city: "Madrid",
    initials: "DC",
    rentCount: 16,
    saleCount: 10,
    lastUpdateMinutes: 1,
  },
  {
    id: "lucas-fox",
    name: "Lucas Fox Madrid",
    city: "Madrid",
    initials: "LF",
    rentCount: 31,
    saleCount: 18,
    lastUpdateMinutes: 1,
  },
  {
    id: "consulting",
    name: "Consulting Properties",
    city: "Madrid",
    initials: "CP",
    rentCount: 22,
    saleCount: 14,
    lastUpdateMinutes: 4,
  },
  {
    id: "walter-haus",
    name: "Walter Haus",
    city: "Madrid",
    initials: "WH",
    rentCount: 11,
    saleCount: 8,
    lastUpdateMinutes: 5,
  },
  {
    id: "nappo",
    name: "Nappo Real Estate",
    city: "Madrid",
    initials: "NB",
    rentCount: 30,
    saleCount: 10,
    lastUpdateMinutes: 2,
  },
  {
    id: "gilmar",
    name: "Gilmar Madrid",
    city: "Madrid",
    initials: "GM",
    rentCount: 0,
    saleCount: 0,
    lastUpdateMinutes: 10,
  },
];

export function getAgenciesStats(agencies: Agency[]) {
  const totalRent = agencies.reduce((sum, a) => sum + a.rentCount, 0);
  const totalSale = agencies.reduce((sum, a) => sum + a.saleCount, 0);
  return {
    totalAgencies: agencies.length,
    totalRent,
    totalSale,
    totalProperties: totalRent + totalSale,
  };
}
