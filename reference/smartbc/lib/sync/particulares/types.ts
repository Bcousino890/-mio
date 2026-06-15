import type { ImportPreview } from "../import-by-link/types";
import type { AdvertiserCheckResult } from "./idealista-advertiser-detector";

export type Particular = ImportPreview & {
  advertiser_type: "particular" | "professional" | "unknown";
  is_ad_professional: boolean | null;
  detected_at: string;
};

export type ParticularFilter = {
  zone?: string;
  subzone?: string;
  operation?: "rent" | "sale";
  priceMin?: number;
  priceMax?: number;
  bedrooms?: number[];
  bathrooms?: number[];
  portals?: string[];
  contactAvailable?: boolean;
  hasRecentChanges?: boolean;
};
