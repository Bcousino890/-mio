export type StayType = "corta" | "larga";
export type Operation = "alquiler" | "venta";
export type PropertyBadge = "exclusiva" | "destacada" | "premium";

export type PropertyFeature =
  | "exterior"
  | "furnished"
  | "balcony"
  | "terrace"
  | "elevator"
  | "equippedKitchen"
  | "garage"
  | "pool"
  | "doorman"
  | "airConditioning";

export type PropertyConditionKind =
  | "deposit"
  | "guarantee"
  | "personalShopper";

export type PropertyCondition = {
  kind: PropertyConditionKind;
  months: number;
};

export type PropertyType = "apartment" | "penthouse" | "house" | "commercial";
export type PropertyState = "excellent" | "good" | "needsRenovation";
export type Heating =
  | "individualGas"
  | "centralGas"
  | "electric"
  | "none";
export type AirConditioning = "yes" | "no" | "preInstalled";
export type EnergyCertificate =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "pending";

export type PropertySpecs = {
  type?: PropertyType;
  state?: PropertyState;
  floor?: string;
  heating?: Heating;
  airConditioning?: AirConditioning;
  energyCertificate?: EnergyCertificate;
};

export type PropertyContact = {
  phone?: string;
  email?: string;
  hoursKey?: string;
  whatsapp?: string;
};

export type Property = {
  id: string;
  title: string;
  zone: string;
  subzone?: string | null;
  city: string;
  bedrooms: number;
  bathrooms: number;
  squareMeters: number;
  price: number;
  stayType: StayType;
  operation: Operation;
  badge?: PropertyBadge;
  image?: string;
  description?: string;

  // Detail-page extras (optional so existing list cards keep working)
  photos?: string[];
  longDescription?: string;
  features?: PropertyFeature[];
  conditions?: PropertyCondition[];
  specs?: PropertySpecs;
  contact?: PropertyContact;
  // Tipo legible ("Piso", "Ático", "Chalet"…) extraído del scraper o
  // editado manualmente. Opcional para no romper mocks/cards existentes.
  propertyTypeLabel?: string | null;
  // Features como strings libres (vienen del scraper, sin enum estricto).
  // `features` arriba es un enum legacy; este campo es el real para la
  // vista del SmartLink y el detalle público.
  featuresText?: string[];
  // Coordenadas reales (geocodificadas) si las tenemos cacheadas. Si no
  // están, el SmartLink usa coords aproximadas del barrio. Se usan también
  // para el cálculo de distancia a universidades.
  latitude?: number | null;
  longitude?: number | null;
  // Referencia interna BC (BC-0001, BC-0002…). Única por propiedad y
  // distinta del `external_id` del portal de origen. Se muestra al cliente
  // en SmartLink para que pueda mencionarla al contactar con BC.
  bcReference?: string | null;
  // Nº de planta deducido de features/título/descripción (ver lib/floor.ts).
  // null si el anuncio no lo menciona. Ático = ATICO_FLOOR.
  floor?: number | null;
};

export type Filters = {
  bedrooms?: number;
  entryDate?: string;
  stayType?: StayType;
  maxPrice?: number;
  bathrooms?: number;
  minSquareMeters?: number;
  minFloor?: number;
  zone?: string;
  subzone?: string;
  operation?: Operation;
};

// Dashboard / Inicio types
export type Visit = {
  id: string;
  // Stable visual fields so we don't depend on Date locale shenanigans for the mock.
  monthLabel: string; // e.g. "MAY"
  dayLabel: string; // e.g. "24"
  time: string; // e.g. "11:00"
  propertyId: string;
  propertyTitle: string;
  street: string;
  postalCode: string;
};

export type MessageSender = {
  name: string;
  initials?: string; // shown when there's no avatar image
  avatar?: string;
};

export type Message = {
  id: string;
  sender: MessageSender;
  preview: string;
  // Free-form timestamp label like "Hoy, 10:24" — i18n done via key when needed.
  timestampLabelKey?: string;
  timestamp?: string; // raw display text when no key applies
  unread: boolean;
};

export type DashboardStats = {
  upcomingVisits: number;
  favoriteProperties: number;
  unreadMessages: number;
  documents: number;
};

// Favoritos
export type FavoriteEntry = {
  property: Property;
  unavailable?: boolean;
};

// Perfil
export type ClientPreferences = {
  bedrooms?: number;
  budgetMin?: number;
  budgetMax?: number;
  stayType?: StayType;
  operation?: Operation;
  preferredZones: string[];
};

export type ClientProfile = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  preferredLanguage: "es" | "en" | "fr" | "de";
  memberSince: string; // free-form date label, e.g. "Marzo 2024"
  preferences: ClientPreferences;
  // Tags assigned by the Personal Shopper (admin) — i18n keys.
  shopperTagKeys: string[];
};

// Mensajes
export type ConversationMessage = {
  id: string;
  fromMe: boolean;
  text: string;
  time: string; // "10:24"
  dateGroupKey?: string; // "messages.date.today" | "messages.date.yesterday"
  dateGroupLabel?: string; // raw fallback
};

export type Conversation = {
  id: string;
  participant: MessageSender;
  lastPreview: string;
  lastTimestampLabelKey?: string;
  lastTimestamp?: string;
  unreadCount: number;
  messages: ConversationMessage[];
};

// Admin
export type Agency = {
  id: string;
  name: string;
  city: string;
  initials: string; // e.g. "BR" — used for the avatar circle
  rentCount: number;
  saleCount: number;
  // Minutes since last data sync. Used to show "Hace X min" in the UI.
  lastUpdateMinutes: number;
};

export type AdminUser = {
  firstName: string;
  lastName: string;
  initials: string;
  roleKey: string;
};

// Agency detail
export type AgencyStatus = "active" | "inactive";

export type AgencyContact = {
  name: string;
  initials: string;
  roleKey: string; // i18n key, e.g. "agency.contact.role.alliancesDirector"
  phone: string;
  email: string;
  address: string;
};

export type AgencyConditionKind =
  | "sharedCapture"
  | "coordinatedVisits"
  | "operationCommission"
  | "verifiedDocumentation";

export type AgencyPropertyRow = {
  id: string;
  title: string;
  reference: string; // e.g. "BM-9876"
  operation: Operation;
  zone: string;
  bedrooms: number;
  bathrooms: number;
  price: number; // monthly for rent, total for sale
  squareMeters: number | null;
  status: "available" | "reserved" | "rented" | "sold" | "draft";
  // Nº de planta deducido de features/descripción (ver lib/floor.ts).
  // Opcional: los mocks legacy no lo informan.
  floor?: number | null;
  lastUpdateMinutes: number;
  coverPhotoUrl?: string | null;
};

export type AgencyDetail = Agency & {
  status: AgencyStatus;
  country: string;
  // Free-form short label like "Ene 2022" — when backend lands, derive with Intl.
  partnerSinceLabel: string;
  rentCommissionPct: number; // 0-100 — % efectivo que recibe la agencia en alquiler
  saleCommissionPct: number; // 0-100 — % efectivo que recibe la agencia en venta
  // Umbral de precio a partir del cual aplica la colaboración.
  rentCommissionMinPrice: number; // €/mes
  saleCommissionMinPrice: number; // € total
  // Para venta: % de comisión acordado con el vendedor (1-6). La agencia recibe
  // la mitad → saleCommissionPct = saleAgreedCommissionPct / 2.
  saleAgreedCommissionPct: number;
  conditionKeys: AgencyConditionKind[];
  contact: AgencyContact;
  properties: AgencyPropertyRow[];
};

// Admin / Clients view
export type ClientProfileType = "student" | "worker" | "company";
export type ClientStatus = "active" | "inactive";
export type ClientPriority = "normal" | "high";

export type ClientActivity = {
  propertiesViewed: number;
  favorites: number;
  visitsRequested: number;
  messages: number;
  // Either a translated label key + value, or a free-form text fallback.
  lastConnectionLabelKey?: string;
  lastConnectionValue?: string;
  lastConnectionText?: string;
};

export type AdminClient = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  location?: string; // e.g. "Madrid, España"
  avatarInitials: string;

  // Custom filters the admin assigns to this client. They drive what the
  // client sees in their own portal.
  profileType: ClientProfileType;
  operation: Operation;
  stayType: StayType;
  preferredZone: string;
  sector: string;
  budgetMin: number;
  budgetMax: number;
  // Composición del grupo que ocupará la vivienda.
  occupants: number;
  students: number;
  workers: number;
  pets: boolean;

  // Last access label rendered in the table.
  lastAccessLabelKey?: string;
  lastAccessValue?: string;
  lastAccessText?: string;

  status: ClientStatus;
  assignedAdvisor: string;
  activity: ClientActivity;
  // Free-form internal notes the team writes about this client. Not i18n —
  // they're operational notes in whatever language the team writes.
  internalNotes: string[];
  priority: ClientPriority;
};

export type ClientsStats = {
  totalClients: number;
  activeToday: number;
  visitsRequested: number;
  customFilters: number;
  priorityFollowUp: number;
};

// Admin / Propiedades (catalog management)
export type AdminPropertyStatus = "available" | "reserved" | "rented" | "sold" | "draft";

export type AdminProperty = {
  id: string;
  reference: string; // Ref del portal de origen (ej. 3291 en Level)
  // Referencia interna BC (BC-0001, BC-0002…). Única por propiedad.
  bcReference: string | null;
  // Referencia interna amigable en formato PROP-YYYY-NNNN (año + secuencial).
  // Inmutable una vez generada, para mostrar al cliente y admin.
  propertyReference: string;
  title: string;
  zone: string;
  subzone?: string | null;
  agencyId: string;
  agencyName: string;
  operation: Operation;
  // Tipo de estancia para alquileres: "larga" / "corta". null en ventas.
  stayType?: "larga" | "corta" | null;
  status: AdminPropertyStatus;
  bedrooms: number;
  bathrooms: number;
  squareMeters: number;
  price: number;
  // Nº de planta deducido de features/título/descripción (ver lib/floor.ts).
  // Opcional: los mocks legacy no lo informan.
  floor?: number | null;
  publishedLabel: string; // free-form date
  featured?: boolean;
  coverPhotoUrl?: string | null;
  photos?: { url: string; isCover: boolean }[];
};

export type AdminPropertiesStats = {
  total: number;
  rent: number;
  sale: number;
  featured: number;
};

// Admin / Solicitudes
export type VisitRequestStatus =
  | "pending"
  | "confirmed"
  | "rescheduled"
  | "rejected"
  | "completed";

export type VisitRequest = {
  id: string;
  clientName: string;
  clientInitials: string;
  clientEmail?: string;
  propertyTitle: string;
  propertyReference: string;
  propertySlug?: string;
  requestedDateLabel: string; // e.g. "24 May 2026, 11:00"
  createdDateLabel?: string;
  channelKey: string; // i18n: "solicitudes.channel.portal" | ".phone" | ".whatsapp"
  assignedAdvisor: string;
  status: VisitRequestStatus;
  receivedRelativeMinutes: number;
};

export type VisitRequestsStats = {
  total: number;
  pending: number;
  confirmed: number;
  thisWeek: number;
};

// Admin / Reportes
export type ReportsStats = {
  monthlyCommissionsEUR: number;
  monthlyClosedDeals: number;
  conversionRatePct: number;
  averageDaysToClose: number;
};

export type RevenueMonth = {
  monthKey: string; // i18n key like "month.short.jan"
  rentEUR: number;
  saleEUR: number;
};

export type AgencyRanking = {
  agencyId: string;
  name: string;
  initials: string;
  closedDeals: number;
  commissionsEUR: number;
};

// Admin / Usuarios (internal accounts)
export type InternalUserRole =
  | "owner"
  | "admin"
  | "advisor"
  | "client"
  | "viewer"
  | "agent_junior"
  | "agent_senior"
  | "agent_admin";

export type InternalUserStatus = "active" | "invited" | "suspended";

export type InternalUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  initials: string;
  roleKey: InternalUserRole;
  status: InternalUserStatus;
  lastLoginText?: string;
  joinedLabel: string;
};

// Admin / Configuración
export type AppSettings = {
  company: {
    name: string;
    legalName: string;
    taxId: string;
    address: string;
    phone: string;
    email: string;
  };
  branding: {
    primaryColor: string;
    accentColor: string;
  };
  defaults: {
    language: "es" | "en" | "fr" | "de";
    rentCommissionPct: number;
    saleCommissionPct: number;
    personalShopperMonths: number;
  };
  notifications: {
    visitRequests: boolean;
    newClients: boolean;
    weeklyReport: boolean;
    propertyUpdates: boolean;
  };
};
