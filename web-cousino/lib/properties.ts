export type Country = "ESPAÑA" | "CHILE";
export type Currency = "EUR" | "CLP" | "USD";
export type PropertyType =
  | "Villa"
  | "Penthouse"
  | "Piso de lujo"
  | "Finca"
  | "Mansión";
export type OperationType = "Venta" | "Alquiler";

export interface Property {
  slug: string;
  title: string;
  type: PropertyType;
  operation: OperationType;
  country: Country;
  city: string;
  neighborhood: string;
  price: number;
  currency: Currency;
  area: number;
  landArea?: number;
  bedrooms: number;
  bathrooms: number;
  yearBuilt: number;
  architect?: string;
  description: string;
  amenities: string[];
  featured: boolean;
  isNew: boolean;
  offMarket: boolean;
  images: string[];
  agent: {
    name: string;
    title: string;
    phone: string;
    whatsapp: string;
    email: string;
  };
}

const defaultAgent = {
  name: "Benjamín Cousiño",
  title: "Luxury Property Consultant",
  phone: "+34 600 000 000",
  whatsapp: "34600000000",
  email: "contacto@benjamincousino.com",
};

// Sin fotografía real todavía: usamos placeholders locales en lugar de un
// servicio de imágenes externo (evita una dependencia de red en runtime).
const PLACEHOLDER_COUNT = 6;
const img = (seed: number) =>
  `/placeholders/luxury-${(seed % PLACEHOLDER_COUNT) + 1}.svg`;

export const properties: Property[] = [
  {
    slug: "villa-la-moraleja-madrid",
    title: "Villa contemporánea en La Moraleja",
    type: "Villa",
    operation: "Venta",
    country: "ESPAÑA",
    city: "Madrid",
    neighborhood: "La Moraleja",
    price: 6800000,
    currency: "EUR",
    area: 850,
    landArea: 2200,
    bedrooms: 7,
    bathrooms: 8,
    yearBuilt: 2021,
    architect: "Estudio Mansilla+Tuñón",
    description:
      "Villa de diseño contemporáneo emplazada en una de las parcelas más privilegiadas de La Moraleja. Espacios diáfanos, doble altura en el salón principal y una integración total con el jardín y la piscina infinita. Domótica de última generación y máxima privacidad perimetral.",
    amenities: [
      "Cine privado 4K",
      "Piscina temperada",
      "Spa y sauna",
      "Bodega para vinos",
      "Smart Home completo",
      "Vigilancia 24/7",
      "Garaje climatizado",
      "Ascensor privado",
    ],
    featured: true,
    isNew: true,
    offMarket: false,
    images: [img(1018), img(1015), img(1019), img(1016)],
    agent: defaultAgent,
  },
  {
    slug: "atico-salamanca-madrid",
    title: "Ático exclusivo en Barrio Salamanca",
    type: "Penthouse",
    operation: "Venta",
    country: "ESPAÑA",
    city: "Madrid",
    neighborhood: "Salamanca",
    price: 4200000,
    currency: "EUR",
    area: 420,
    bedrooms: 4,
    bathrooms: 4,
    yearBuilt: 2019,
    description:
      "Ático reformado a la última en pleno corazón de Salamanca con tres terrazas y vistas panorámicas a la ciudad. Acabados de mármol travertino, cocina Gaggenau y ascensor privado directo a vivienda.",
    amenities: [
      "Terraza panorámica",
      "Ascensor privado",
      "Domótica (Philips Hue)",
      "Climatización zonal",
      "Concierge 24/7",
    ],
    featured: true,
    isNew: false,
    offMarket: false,
    images: [img(1024), img(1031), img(1039)],
    agent: defaultAgent,
  },
  {
    slug: "finca-marbella-golden-mile",
    title: "Finca de autor en la Milla de Oro",
    type: "Finca",
    operation: "Venta",
    country: "ESPAÑA",
    city: "Marbella",
    neighborhood: "Milla de Oro",
    price: 12500000,
    currency: "EUR",
    area: 1400,
    landArea: 8000,
    bedrooms: 9,
    bathrooms: 11,
    yearBuilt: 2018,
    architect: "Joaquín Torres",
    description:
      "Propiedad insignia de la Milla de Oro con acceso directo a la playa, helipuerto privado y vistas al estrecho de Gibraltar. Concebida para el entretenimiento al más alto nivel, con instalaciones deportivas completas.",
    amenities: [
      "Helipuerto privado",
      "Cancha de tenis/pádel",
      "Bodega para vinos",
      "Spa y sauna",
      "Sistema biométrico",
      "Personal de seguridad",
      "Acceso playa privado",
    ],
    featured: true,
    isNew: false,
    offMarket: true,
    images: [img(1043), img(1048), img(1051)],
    agent: defaultAgent,
  },
  {
    slug: "villa-ibiza-vistas-mar",
    title: "Villa minimalista con vistas al mar",
    type: "Villa",
    operation: "Venta",
    country: "ESPAÑA",
    city: "Ibiza",
    neighborhood: "Cala Tarida",
    price: 7900000,
    currency: "EUR",
    area: 680,
    landArea: 3500,
    bedrooms: 6,
    bathrooms: 6,
    yearBuilt: 2020,
    description:
      "Arquitectura mediterránea minimalista frente al mar, con piscina infinita orientada al atardecer. Diseño de interiores firmado y jardines mediterráneos de bajo mantenimiento.",
    amenities: [
      "Piscina infinita",
      "Vistas al mar",
      "Jacuzzi/Hot tub",
      "Audio multizona",
      "Gestor de jardines",
    ],
    featured: false,
    isNew: true,
    offMarket: false,
    images: [img(1060), img(1062), img(1067)],
    agent: defaultAgent,
  },
  {
    slug: "penthouse-las-condes-santiago",
    title: "Penthouse panorámico en Las Condes",
    type: "Penthouse",
    operation: "Venta",
    country: "CHILE",
    city: "Santiago",
    neighborhood: "Las Condes",
    price: 1850000000,
    currency: "CLP",
    area: 380,
    bedrooms: 4,
    bathrooms: 5,
    yearBuilt: 2022,
    description:
      "Penthouse de altísimas especificaciones en uno de los edificios más exclusivos de Las Condes, con vistas a la cordillera de los Andes y terraza con piscina privada.",
    amenities: [
      "Piscina privada en terraza",
      "Smart Home completo",
      "Gimnasio privado",
      "Concierge 24/7",
      "Reconocimiento facial",
    ],
    featured: true,
    isNew: true,
    offMarket: false,
    images: [img(1074), img(1080), img(1084)],
    agent: defaultAgent,
  },
  {
    slug: "casa-sausalito-vina-del-mar",
    title: "Residencia frente al lago en Sausalito",
    type: "Mansión",
    operation: "Venta",
    country: "CHILE",
    city: "Viña del Mar",
    neighborhood: "Sausalito",
    price: 2400000000,
    currency: "CLP",
    area: 920,
    landArea: 4200,
    bedrooms: 6,
    bathrooms: 7,
    yearBuilt: 2017,
    description:
      "Residencia familiar de gran formato frente al lago Sausalito, con muelle privado, casa de huéspedes independiente y jardines diseñados por paisajista.",
    amenities: [
      "Muelle privado",
      "Casa de huéspedes",
      "Bodega para vinos",
      "Cine privado 4K",
      "Vigilancia 24/7",
    ],
    featured: true,
    isNew: false,
    offMarket: false,
    images: [img(1015), img(1024), img(1043)],
    agent: defaultAgent,
  },
  {
    slug: "parcela-la-calera-vinedo",
    title: "Parcela agrícola con viñedo en La Calera",
    type: "Finca",
    operation: "Venta",
    country: "CHILE",
    city: "La Calera",
    neighborhood: "Valle del Aconcagua",
    price: 980000000,
    currency: "CLP",
    area: 450,
    landArea: 120000,
    bedrooms: 5,
    bathrooms: 4,
    yearBuilt: 2015,
    description:
      "Parcela productiva con viñedo establecido en el Valle del Aconcagua, casa patronal restaurada y vistas a la cordillera. Potencial enoturístico e inversión agrícola de alto valor.",
    amenities: [
      "Viñedo productivo",
      "Casa patronal restaurada",
      "Bodega para vinos",
      "Gestor de jardines",
    ],
    featured: false,
    isNew: false,
    offMarket: true,
    images: [img(1048), img(1051), img(1060)],
    agent: defaultAgent,
  },
  {
    slug: "piso-eixample-barcelona",
    title: "Piso señorial en el Eixample",
    type: "Piso de lujo",
    operation: "Venta",
    country: "ESPAÑA",
    city: "Barcelona",
    neighborhood: "Eixample",
    price: 3100000,
    currency: "EUR",
    area: 310,
    bedrooms: 4,
    bathrooms: 3,
    yearBuilt: 1910,
    architect: "Restauración original modernista",
    description:
      "Piso señorial en finca modernista catalogada, restaurado con respeto al patrimonio original: suelos hidráulicos, techos artesonados y galería acristalada. Ubicación inmejorable junto a Passeig de Gràcia.",
    amenities: [
      "Patrimonio histórico",
      "Climatización zonal",
      "Domótica integrada",
      "Conserje en finca",
    ],
    featured: false,
    isNew: true,
    offMarket: false,
    images: [img(1062), img(1067), img(1074)],
    agent: defaultAgent,
  },
];

export function getPropertyBySlug(slug: string) {
  return properties.find((p) => p.slug === slug);
}

export function getFeaturedProperties() {
  return properties.filter((p) => p.featured);
}

export function getSimilarProperties(property: Property, limit = 4) {
  return properties
    .filter(
      (p) =>
        p.slug !== property.slug &&
        (p.country === property.country || p.type === property.type)
    )
    .slice(0, limit);
}
