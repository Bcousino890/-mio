// Row-level types puros (sin side-effects). Seguros de importar desde Client Components.
// Las queries que tocan Supabase viven en `lib/db/queries/*.ts` con `import "server-only"`.

import type { Database, PropertyOperation, PropertyStay } from "./database.types";

export type AgencyRow = Database["public"]["Tables"]["agencies"]["Row"];
export type AgencyPartnershipRow = Database["public"]["Tables"]["agency_partnerships"]["Row"];
export type AgencyFeedRow = Database["public"]["Tables"]["agency_feeds"]["Row"];
export type SyncLogRow = Database["public"]["Tables"]["sync_logs"]["Row"];

export type FeedWithAgency = AgencyFeedRow & {
  agencies: Pick<AgencyRow, "id" | "name" | "slug" | "logo_url"> | null;
};

export type AgencyWithStats = AgencyRow & {
  agency_partnerships: AgencyPartnershipRow[] | null;
  rent_count: number;
  sale_count: number;
};

export type PropertyRow = Database["public"]["Tables"]["properties"]["Row"];

export type PropertyFilters = {
  operation?: PropertyOperation;
  stay?: PropertyStay;
  zones?: string[];
  minPrice?: number;
  maxPrice?: number;
  minBedrooms?: number;
  maxBedrooms?: number;
  minBathrooms?: number;
  minSquareMeters?: number;
  availableFrom?: string;
  includeUnavailable?: boolean;
};

export type ClientPreferencesRow = Database["public"]["Tables"]["client_preferences"]["Row"];
export type ClientTagRow = Database["public"]["Tables"]["client_tags"]["Row"];

export type ClientWithRelations = Database["public"]["Tables"]["profiles"]["Row"] & {
  client_preferences: ClientPreferencesRow | null;
  client_tag_assignments: Array<{ tag_id: string; client_tags: ClientTagRow }>;
  favorites: Array<{ count: number }>;
  visit_requests: Array<{ count: number }>;
};

export type VisitRequestWithRelations =
  Database["public"]["Tables"]["visit_requests"]["Row"] & {
    profiles: { id: string; full_name: string | null; email: string } | null;
    properties: {
      id: string;
      slug: string;
      title: string;
      external_id: string | null;
    } | null;
  };
