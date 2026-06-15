import type {
  AgencyRanking,
  AppSettings,
  ReportsStats,
  RevenueMonth,
} from "@/lib/types";

// Mocks vivos: alimentan /admin/reportes y /admin/configuracion hasta que
// se cableen a BD (Fase 3a iter 2 + Fase 7 para settings reales).

// ----- Reportes -----

export const mockReportsStats: ReportsStats = {
  monthlyCommissionsEUR: 184500,
  monthlyClosedDeals: 17,
  conversionRatePct: 23,
  averageDaysToClose: 42,
};

export const mockRevenueByMonth: RevenueMonth[] = [
  { monthKey: "month.short.dec", rentEUR: 38200, saleEUR: 92000 },
  { monthKey: "month.short.jan", rentEUR: 41500, saleEUR: 110000 },
  { monthKey: "month.short.feb", rentEUR: 39800, saleEUR: 98500 },
  { monthKey: "month.short.mar", rentEUR: 47100, saleEUR: 145200 },
  { monthKey: "month.short.apr", rentEUR: 51400, saleEUR: 128900 },
  { monthKey: "month.short.may", rentEUR: 54300, saleEUR: 130200 },
];

export const mockAgencyRanking: AgencyRanking[] = [
  {
    agencyId: "lucas-fox",
    name: "Lucas Fox Madrid",
    initials: "LF",
    closedDeals: 12,
    commissionsEUR: 78500,
  },
  {
    agencyId: "barnes",
    name: "Barnes Madrid",
    initials: "BR",
    closedDeals: 9,
    commissionsEUR: 64200,
  },
  {
    agencyId: "alvora",
    name: "Álvora Capital Properties",
    initials: "AC",
    closedDeals: 7,
    commissionsEUR: 41800,
  },
  {
    agencyId: "nappo",
    name: "Nappo Real Estate",
    initials: "NB",
    closedDeals: 5,
    commissionsEUR: 32900,
  },
  {
    agencyId: "de-salas",
    name: "De Salas Luxury Homes",
    initials: "DC",
    closedDeals: 4,
    commissionsEUR: 28100,
  },
];

// ----- Settings -----

export const mockAppSettings: AppSettings = {
  company: {
    name: "Benjamín Cousiño Propiedades",
    legalName: "Benjamín Cousiño Propiedades S.L.",
    taxId: "B-12345678",
    address: "Calle de Velázquez, 76, 28001 Madrid",
    phone: "+34 91 123 45 67",
    email: "info@bencousinopropiedades.com",
  },
  branding: {
    primaryColor: "#0a0a0a",
    accentColor: "#c9a96e",
  },
  defaults: {
    language: "es",
    rentCommissionPct: 35,
    saleCommissionPct: 25,
    personalShopperMonths: 1,
  },
  notifications: {
    visitRequests: true,
    newClients: true,
    weeklyReport: true,
    propertyUpdates: false,
  },
};
