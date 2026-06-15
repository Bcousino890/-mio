import type { Property, PropertyContact } from "@/lib/types";

export const MADRID_ZONES = [
  "Salamanca",
  "Chamberí",
  "Justicia",
  "Retiro",
  "Chamartín",
  "Centro",
  "Almagro",
  "Recoletos",
  "Malasaña",
] as const;

const DEFAULT_CONTACT: PropertyContact = {
  phone: "+34 915 123 456",
  email: "info@bencousinopropiedades.com",
  hoursKey: "detail.contact.hours",
  whatsapp: "+34915123456",
};

export const mockProperties: Property[] = [
  {
    id: "vel-12",
    title: "Piso en Calle de Velázquez",
    zone: "Salamanca",
    city: "Madrid",
    bedrooms: 3,
    bathrooms: 2,
    squareMeters: 135,
    price: 4800,
    stayType: "corta",
    operation: "alquiler",
    badge: "exclusiva",
    longDescription:
      "Benjamín Cousiño Propiedades presenta este exclusivo piso en Calle de Velázquez, una de las direcciones más prestigiosas del barrio de Salamanca.\n\nLa vivienda, completamente amueblada y decorada con un gusto exquisito, destaca por su luminosidad, sus balcones exteriores y sus acabados de alta gama. Dispone de un amplio salón con varios ambientes, comedor independiente, cocina equipada con electrodomésticos de última generación, tres dormitorios (principal en suite) y dos baños completos.\n\nUna propiedad única para quienes buscan confort, diseño y una ubicación inmejorable en Madrid.",
    features: [
      "exterior",
      "furnished",
      "balcony",
      "elevator",
      "equippedKitchen",
    ],
    conditions: [
      { kind: "deposit", months: 1 },
      { kind: "guarantee", months: 1 },
      { kind: "personalShopper", months: 1 },
    ],
    specs: {
      type: "apartment",
      state: "excellent",
      floor: "3ª Exterior",
      heating: "individualGas",
      airConditioning: "yes",
      energyCertificate: "pending",
    },
    contact: DEFAULT_CONTACT,
  },
  {
    id: "abas-08",
    title: "Piso en Calle de José Abascal",
    zone: "Chamberí",
    city: "Madrid",
    bedrooms: 2,
    bathrooms: 2,
    squareMeters: 110,
    price: 3200,
    stayType: "corta",
    operation: "alquiler",
    badge: "destacada",
    longDescription:
      "Benjamín Cousiño Propiedades presenta este elegante piso en Calle de José Abascal, en pleno corazón de Chamberí.\n\nVivienda totalmente reformada y amueblada con materiales de primera calidad. Distribución funcional con dos dormitorios, dos baños completos, salón-comedor y cocina office independiente. Edificio con conserjería 24 horas y excelentes comunicaciones.\n\nIdeal para profesionales o parejas que buscan calidad de vida en una zona consolidada de Madrid.",
    features: ["furnished", "elevator", "equippedKitchen", "doorman"],
    conditions: [
      { kind: "deposit", months: 1 },
      { kind: "guarantee", months: 1 },
      { kind: "personalShopper", months: 1 },
    ],
    specs: {
      type: "apartment",
      state: "excellent",
      floor: "5ª Interior",
      heating: "centralGas",
      airConditioning: "yes",
      energyCertificate: "C",
    },
    contact: DEFAULT_CONTACT,
  },
  {
    id: "hor-21",
    title: "Ático en Calle de Hortaleza",
    zone: "Justicia",
    city: "Madrid",
    bedrooms: 3,
    bathrooms: 3,
    squareMeters: 150,
    price: 6200,
    stayType: "corta",
    operation: "alquiler",
    badge: "premium",
    description:
      "Ático exclusivo con terraza privada, acabados de lujo y vistas despejadas en una de las zonas más codiciadas de Madrid.",
    longDescription:
      "Benjamín Cousiño Propiedades presenta este excepcional ático en Calle de Hortaleza, en el codiciado barrio de Justicia.\n\nVivienda con terraza privada de uso exclusivo y vistas despejadas a la ciudad. Tres dormitorios, tres baños completos (dos en suite), amplio salón con doble altura y cocina abierta totalmente equipada. Acabados premium en suelos, carpintería y baños.\n\nUna oportunidad única para quien busca la combinación perfecta entre exclusividad, ubicación céntrica y vida al aire libre en pleno Madrid.",
    features: [
      "exterior",
      "furnished",
      "terrace",
      "elevator",
      "equippedKitchen",
      "airConditioning",
    ],
    conditions: [
      { kind: "deposit", months: 2 },
      { kind: "guarantee", months: 1 },
      { kind: "personalShopper", months: 1 },
    ],
    specs: {
      type: "penthouse",
      state: "excellent",
      floor: "Ático Exterior",
      heating: "individualGas",
      airConditioning: "yes",
      energyCertificate: "B",
    },
    contact: DEFAULT_CONTACT,
  },
];

export function getPropertyById(id: string): Property | undefined {
  return mockProperties.find((p) => p.id === id);
}
