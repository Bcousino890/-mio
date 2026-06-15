// Adapters: convierten rows de Supabase al shape que esperan los componentes UI legacy.
// A medida que migramos componentes a los tipos de BD directamente, estos adapters se eliminan.

import type {
  AdminClient,
  AdminProperty,
  AdminPropertyStatus,
  Agency,
  AgencyDetail,
  ClientPriority,
  ClientProfileType,
  ClientStatus,
  InternalUser,
  InternalUserRole,
  Operation,
  Property,
  StayType,
  VisitRequest,
  VisitRequestStatus,
} from "@/lib/types";
import { extractFloor } from "@/lib/floor";
import type {
  Database,
  PropertyStatus,
  VisitStatus,
} from "./database.types";
import type {
  AgencyPartnershipRow,
  AgencyRow,
  AgencyWithStats,
  ClientWithRelations,
  PropertyRow,
  VisitRequestWithRelations,
} from "./row-types";

export function minutesSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const diffMs = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(diffMs / 60000));
}

export function deriveInitials(name: string, fallback = ""): string {
  const cleaned = name.replace(/[^\p{L}\s]/gu, " ").trim();
  const parts = cleaned.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (parts[0]?.slice(0, 2) ?? fallback).toUpperCase();
}

const PARTNER_SINCE_FMT = new Intl.DateTimeFormat("es-ES", {
  month: "short",
  year: "numeric",
});

export function agencyDetailFromDb(
  dbAgency: AgencyRow & {
    // Supabase devuelve un OBJETO cuando la FK es unique (1:1), array cuando es 1:N.
    // El schema declara agency_id como `unique`, así que en runtime es un objeto.
    agency_partnerships:
      | AgencyPartnershipRow
      | AgencyPartnershipRow[]
      | null;
  },
  fallback: AgencyDetail,
): AgencyDetail {
  const partnership = Array.isArray(dbAgency.agency_partnerships)
    ? (dbAgency.agency_partnerships[0] ?? null)
    : (dbAgency.agency_partnerships ?? null);
  const contactName = dbAgency.contact_name ?? fallback.contact.name;
  const partnerSinceLabel = partnership?.agreement_signed_at
    ? PARTNER_SINCE_FMT.format(new Date(partnership.agreement_signed_at))
    : fallback.partnerSinceLabel;

  const saleAgreedPct =
    partnership?.sale_agreed_commission_pct != null
      ? Number(partnership.sale_agreed_commission_pct)
      : fallback.saleAgreedCommissionPct;
  // La agencia recibe la mitad de la comisión acordada. Si la BD trae un
  // sale_commission_pct directo (datos legacy), lo respetamos.
  const saleEffectivePct =
    partnership?.sale_commission_pct != null
      ? Number(partnership.sale_commission_pct)
      : saleAgreedPct / 2;

  return {
    ...fallback,
    id: dbAgency.slug,
    name: dbAgency.name,
    initials: deriveInitials(dbAgency.name, dbAgency.slug),
    lastUpdateMinutes: minutesSince(dbAgency.updated_at),
    partnerSinceLabel,
    rentCommissionPct: Number(
      partnership?.rent_commission_pct ??
        partnership?.commission_pct ??
        fallback.rentCommissionPct,
    ),
    saleCommissionPct: saleEffectivePct,
    rentCommissionMinPrice: Number(
      partnership?.rent_commission_min_price ??
        fallback.rentCommissionMinPrice,
    ),
    saleCommissionMinPrice: Number(
      partnership?.sale_commission_min_price ??
        fallback.saleCommissionMinPrice,
    ),
    saleAgreedCommissionPct: saleAgreedPct,
    contact: {
      ...fallback.contact,
      name: contactName,
      initials: deriveInitials(contactName, fallback.contact.initials),
      // Email/teléfono/dirección salen SOLO de BD (vacío si no hay). NO se
      // hereda el contacto del mock de otra agencia: antes una agencia con el
      // email vacío mostraba el de Level (carmen@levelrealestate.es). La
      // dirección no está modelada en BD, así que no se inventa.
      phone: dbAgency.contact_phone ?? "",
      email: dbAgency.contact_email ?? "",
      address: "",
    },
  };
}

export function agencyRowToLegacy(row: AgencyWithStats): Agency {
  return {
    id: row.slug,
    name: row.name,
    city: "Madrid",
    initials: deriveInitials(row.name, row.slug),
    rentCount: row.rent_count,
    saleCount: row.sale_count,
    lastUpdateMinutes: minutesSince(row.updated_at),
  };
}

const PROPERTY_STATUS_MAP: Record<PropertyStatus, AdminPropertyStatus> = {
  available: "available",
  reserved: "reserved",
  sold: "sold",
  archived: "draft",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const PROFILE_TYPE_BY_TAG: Record<string, ClientProfileType> = {
  Estudiante: "student",
  Trabajador: "worker",
  Empresa: "company",
};

export function clientRowToAdminClient(row: ClientWithRelations): AdminClient {
  const tags = row.client_tag_assignments?.map((a) => a.client_tags) ?? [];
  const fullName = row.full_name?.trim() || row.email;
  const [firstName, ...rest] = fullName.split(/\s+/);
  const lastName = rest.join(" ");
  const initials = deriveInitials(fullName);

  const profileType: ClientProfileType =
    tags.map((t) => PROFILE_TYPE_BY_TAG[t.name]).find(Boolean) ?? "worker";

  const prefs = row.client_preferences;
  const operation: Operation =
    prefs?.operation === "sale" ? "venta" : "alquiler";
  const stayType: StayType = prefs?.stay === "long" ? "larga" : "corta";

  const favoritesCount = row.favorites?.[0]?.count ?? 0;
  const visitsCount = row.visit_requests?.[0]?.count ?? 0;

  return {
    id: row.id,
    firstName: firstName ?? "",
    lastName,
    email: row.email,
    phone: row.phone ?? undefined,
    location: undefined,
    avatarInitials: initials,
    profileType,
    operation,
    stayType,
    preferredZone: prefs?.zones?.[0] ?? "—",
    sector: "Madrid",
    budgetMin: Number(prefs?.min_price ?? 0),
    budgetMax: Number(prefs?.max_price ?? 0),
    occupants: prefs?.occupants ?? 1,
    students: prefs?.students ?? 0,
    workers: prefs?.workers ?? 1,
    pets: prefs?.pets ?? false,
    lastAccessText: undefined,
    status: "active" as ClientStatus,
    assignedAdvisor: "—",
    activity: {
      propertiesViewed: 0,
      favorites: favoritesCount,
      visitsRequested: visitsCount,
      messages: 0,
    },
    internalNotes: prefs?.notes ? [prefs.notes] : [],
    priority: "normal" as ClientPriority,
  };
}

const VISIT_STATUS_MAP: Record<VisitStatus, VisitRequestStatus> = {
  pending: "pending",
  confirmed: "confirmed",
  cancelled: "rejected",
  completed: "completed",
};

const VISIT_DATETIME_FMT = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function visitRequestRowToLegacy(
  row: VisitRequestWithRelations
): VisitRequest {
  const clientName = row.profiles?.full_name?.trim() || row.profiles?.email || "—";
  return {
    id: row.id,
    clientName,
    clientInitials: deriveInitials(clientName),
    clientEmail: row.profiles?.email,
    propertyTitle: row.properties?.title ?? "—",
    propertyReference: row.properties?.external_id ?? row.properties?.slug ?? "",
    propertySlug: row.properties?.slug,
    requestedDateLabel: VISIT_DATETIME_FMT.format(new Date(row.requested_at)),
    createdDateLabel: VISIT_DATETIME_FMT.format(new Date(row.created_at)),
    channelKey: "solicitudes.channel.portal",
    assignedAdvisor: "—",
    status: VISIT_STATUS_MAP[row.status],
    receivedRelativeMinutes: minutesSince(row.created_at),
  };
}

export function profileRowToInternalUser(
  row: Database["public"]["Tables"]["profiles"]["Row"]
): InternalUser {
  const display = row.full_name?.trim() || row.email;
  const [firstName, ...rest] = display.split(/\s+/);
  return {
    id: row.id,
    firstName: firstName ?? "",
    lastName: rest.join(" "),
    email: row.email,
    initials: deriveInitials(display),
    roleKey: (["owner", "admin", "advisor", "client", "viewer", "agent_junior", "agent_senior", "agent_admin"].includes(row.role ?? "")
      ? row.role
      : "advisor") as InternalUserRole,
    status: "active",
    joinedLabel: DATE_FORMATTER.format(new Date(row.created_at)),
  };
}

// Títulos placeholder que algunos datos antiguos guardaron en BD ("Titulo",
// "Title", "Propiedad", string vacío…). Cuando vienen así, generamos uno
// descriptivo basado en tipo + zona para evitar mostrar "Titulo" al cliente.
const GENERIC_TITLE_RE = /^(t[ií]tulos?|titles?|propiedad|sin t[ií]tulo|untitled|—|-)$/i;

function displayPropertyTitle(row: PropertyRow): string {
  const raw = row.title?.trim() ?? "";
  if (raw && !GENERIC_TITLE_RE.test(raw)) return raw;
  const typ = row.property_type?.trim();
  const typeLabel =
    typ && typ.length > 0
      ? typ.charAt(0).toUpperCase() + typ.slice(1).toLowerCase()
      : "Vivienda";
  return `${typeLabel} en ${row.zone}`;
}

// Hash corto y estable de una lista de strings (para versionar las URLs de
// fotos del proxy y poder invalidar su caché al reordenar/añadir/borrar).
function hashStrings(parts: string[]): string {
  const s = parts.join("|");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Quita fotos repetidas (misma url) conservando el orden por posición. Defiende
// la galería de filas duplicadas en property_photos: un re-import con carrera o
// doble submit podía dejar 2 filas por posición, y se veía "cada foto dos veces".
function dedupePhotosByUrl<T extends { url: string }>(photos: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of photos) {
    if (seen.has(p.url)) continue;
    seen.add(p.url);
    out.push(p);
  }
  return out;
}

export function propertyRowToClientProperty(
  row: PropertyRow & {
    agencies?: { name: string; slug: string } | null;
    property_photos?: Array<{ url: string; is_cover: boolean; position: number }>;
  },
): Property {
  const sortedPhotos = dedupePhotosByUrl(
    row.property_photos
      ?.slice()
      .sort((a, b) => a.position - b.position) ?? [],
  );
  // URLs neutras vía el proxy /p/{slug}/{idx} — no exponemos rutas de
  // Storage internas (que delatan el portal de origen, ej. `synced/level/…`).
  // El proxy cachea 24h, así que añadimos `?v=` con un hash que cambia cuando
  // las fotos pueden haber cambiado:
  //  - el ORDEN/URLs de las fotos (reordenar/añadir/borrar), y
  //  - `last_synced_at`: clave cuando se REPROCESA una foto en la MISMA ruta
  //    (ej. re-importar con la marca de agua ya quitada). Sin esto, la URL del
  //    proxy no cambiaba y el navegador servía la versión vieja cacheada.
  // Es seguro: el diff-engine solo toca `last_synced_at` cuando hay cambios
  // reales (needsUpdate), así que un sync que no toca nada preserva la caché.
  const freshness =
    (row as { last_synced_at?: string | null }).last_synced_at ??
    (row as { updated_at?: string | null }).updated_at ??
    "";
  const orderHash = hashStrings([...sortedPhotos.map((p) => p.url), freshness]);
  const photoUrls = sortedPhotos.map(
    (_, i) => `/p/${row.slug}/${i}?v=${orderHash}`,
  );
  const cover = photoUrls[0];
  return {
    id: row.slug,
    title: displayPropertyTitle(row),
    zone: row.zone,
    subzone: row.subzone ?? null,
    city: "Madrid",
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    squareMeters: row.square_meters ?? 0,
    price: Number(row.price),
    stayType: row.stay === "short" ? "corta" : "larga",
    operation: row.operation === "rent" ? "alquiler" : "venta",
    image: cover ?? undefined,
    description: row.description ?? undefined,
    photos: photoUrls,
    longDescription: row.description ?? undefined,
    propertyTypeLabel: row.property_type ?? null,
    // Features auto-extraídas del scraper + manuales del admin, deduplicadas.
    featuresText: Array.from(
      new Set([...(row.features ?? []), ...(row.features_manual ?? [])]),
    ),
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    bcReference: row.bc_reference ?? null,
    floor: extractFloor(
      [...(row.features ?? []), ...(row.features_manual ?? [])],
      row.title,
      row.description,
    ),
  };
}

export function propertyRowToAdminProperty(
  row: PropertyRow & {
    agencies?: { name: string; slug: string } | null;
    property_photos?: Array<{ url: string; is_cover: boolean; position: number }>;
  }
): AdminProperty {
  const sortedPhotos = dedupePhotosByUrl(
    row.property_photos
      ?.slice()
      .sort((a, b) => a.position - b.position) ?? [],
  ).map((p) => ({ url: p.url, isCover: p.is_cover }));

  return {
    id: row.slug,
    reference: row.external_id ?? row.id.slice(0, 8).toUpperCase(),
    bcReference: row.bc_reference ?? null,
    propertyReference: (row as any).property_reference ?? "PROP-2026-0000",
    title: row.title,
    zone: row.zone,
    subzone: row.subzone ?? null,
    agencyId: row.agencies?.slug ?? "",
    agencyName: row.agencies?.name ?? "—",
    operation: row.operation === "rent" ? "alquiler" : "venta",
    stayType:
      row.stay === "short" ? "corta" : row.stay === "long" ? "larga" : null,
    status: PROPERTY_STATUS_MAP[row.status],
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    squareMeters: row.square_meters ?? 0,
    price: Number(row.price),
    floor: extractFloor(
      [...(row.features ?? []), ...(row.features_manual ?? [])],
      row.title,
      row.description,
    ),
    publishedLabel: DATE_FORMATTER.format(new Date(row.created_at)),
    featured: false,
    coverPhotoUrl: row.cover_photo_url,
    photos: sortedPhotos,
  };
}
