import type {
  DashboardStats,
  Message,
  Property,
  Visit,
} from "@/lib/types";

export const mockClient = {
  firstName: "María",
  lastName: "Álvarez",
  fullName: "María Álvarez",
};

export const mockStats: DashboardStats = {
  upcomingVisits: 2,
  favoriteProperties: 5,
  unreadMessages: 3,
  documents: 4,
};

export const mockVisits: Visit[] = [
  {
    id: "v-001",
    monthLabel: "MAY",
    dayLabel: "24",
    time: "11:00",
    propertyId: "vel-12",
    propertyTitle: "Piso en Salamanca",
    street: "C/ Velázquez, 103",
    postalCode: "28006 Madrid",
  },
  {
    id: "v-002",
    monthLabel: "MAY",
    dayLabel: "27",
    time: "16:30",
    propertyId: "hor-21",
    propertyTitle: "Ático en Chamberí",
    street: "C/ Rafael Calvo, 15",
    postalCode: "28010 Madrid",
  },
];

export const mockMessages: Message[] = [
  {
    id: "m-001",
    sender: {
      name: "Javier Cousiño",
      initials: "JC",
    },
    preview:
      "Te envío más información sobre el ático en Chamberí que visitamos.",
    timestampLabelKey: "inicio.time.todayAt",
    timestamp: "10:24",
    unread: true,
  },
  {
    id: "m-002",
    sender: {
      name: "Laura de Benjamín Cousiño",
      initials: "LC",
    },
    preview: "Nueva propiedad que podría interesarte en Recoletos.",
    timestampLabelKey: "inicio.time.yesterdayAt",
    timestamp: "18:45",
    unread: true,
  },
  {
    id: "m-003",
    sender: {
      name: "Ana Sánchez",
      initials: "AS",
    },
    preview: "Documentación firmada correctamente. ¡Gracias!",
    timestampLabelKey: "inicio.time.yesterdayAt",
    timestamp: "12:11",
    unread: false,
  },
];

// Recommendations are full Property objects so we can reuse the property card.
// These are not part of mock-properties so they don't pollute the listing.
export const mockRecommendation: Property = {
  id: "rec-recoletos",
  title: "Piso en Recoletos",
  zone: "Recoletos",
  city: "Madrid",
  bedrooms: 3,
  bathrooms: 2,
  squareMeters: 142,
  // For sale operations the `price` field holds the total sale price.
  // The view layer uses property.operation to decide whether to render "/mes".
  price: 2350000,
  stayType: "larga",
  operation: "venta",
  badge: "premium",
};

export const mockRecommendedProperties: Property[] = [
  {
    id: "rec-001",
    title: "Piso en Almagro",
    zone: "Almagro",
    city: "Madrid",
    bedrooms: 2,
    bathrooms: 2,
    squareMeters: 95,
    price: 2900,
    stayType: "corta",
    operation: "alquiler",
  },
  {
    id: "rec-002",
    title: "Casa con jardín en Aravaca",
    zone: "Centro",
    city: "Madrid",
    bedrooms: 4,
    bathrooms: 3,
    squareMeters: 220,
    price: 5400,
    stayType: "larga",
    operation: "alquiler",
  },
  {
    id: "rec-003",
    title: "Ático en Justicia",
    zone: "Justicia",
    city: "Madrid",
    bedrooms: 2,
    bathrooms: 2,
    squareMeters: 105,
    price: 3700,
    stayType: "corta",
    operation: "alquiler",
  },
  {
    id: "rec-004",
    title: "Piso reformado en Chamberí",
    zone: "Chamberí",
    city: "Madrid",
    bedrooms: 3,
    bathrooms: 2,
    squareMeters: 130,
    price: 4100,
    stayType: "corta",
    operation: "alquiler",
  },
];
