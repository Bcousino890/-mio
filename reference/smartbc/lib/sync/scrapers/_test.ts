import type { Scraper } from "../types";

// Scraper sintético: devuelve 3 propiedades fake con fotos reales públicas.
// Sirve para validar el motor de Fase 4 antes de escribir el scraper real de
// Level (Fase 5). Cuando exista el scraper real, este test se mantiene como
// fixture para desarrollo local sin pegar a la web origen.
export const testScraper: Scraper = {
  key: "_test",
  label: "Test (fixture en memoria)",
  agencySlug: "level-real-estate",
  scrape: async () => {
    return [
      {
        externalId: "TEST-0001",
        sourceUrl: "https://levelrealestate.es/property/test-1",
        title: "Ático con terraza en Salamanca",
        description:
          "Vivienda exterior totalmente reformada con vistas despejadas y dos plazas de garaje incluidas.",
        operation: "rent",
        stay: "long",
        price: 5400,
        bedrooms: 3,
        bathrooms: 2,
        squareMeters: 165,
        zone: "Salamanca",
        address: "Calle Velázquez",
        features: ["Terraza", "Garaje", "Aire acondicionado", "Reformado"],
        photos: [
          {
            url: "https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=1600",
            alt: "Salón principal",
          },
          {
            url: "https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=1600",
            alt: "Terraza",
          },
        ],
      },
      {
        externalId: "TEST-0002",
        sourceUrl: "https://levelrealestate.es/property/test-2",
        title: "Piso clásico en Chamberí reformado",
        description:
          "Edificio histórico con techos altos, suelos de madera originales y portero físico.",
        operation: "sale",
        price: 1250000,
        bedrooms: 4,
        bathrooms: 3,
        squareMeters: 210,
        zone: "Chamberí",
        address: "Calle Almagro",
        features: ["Portero", "Techos altos", "Reformado", "Ascensor"],
        photos: [
          {
            url: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1600",
            alt: "Vista del salón",
          },
        ],
      },
      {
        externalId: "TEST-0003",
        sourceUrl: "https://levelrealestate.es/property/test-3",
        title: "Vivienda con piscina en La Moraleja",
        description:
          "Chalet independiente con jardín mediterráneo, piscina climatizada y casa de invitados.",
        operation: "rent",
        stay: "long",
        price: 12500,
        bedrooms: 6,
        bathrooms: 5,
        squareMeters: 720,
        zone: "La Moraleja",
        address: "Avenida del Marqués de la Cumbre",
        features: ["Piscina", "Jardín", "Garaje", "Casa de invitados"],
        photos: [
          {
            url: "https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1600",
            alt: "Fachada principal",
          },
          {
            url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1600",
            alt: "Piscina",
          },
        ],
      },
    ];
  },
};
