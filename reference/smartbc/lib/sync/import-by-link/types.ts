import type { PropertyOperation, PropertyStay } from "@/lib/db/database.types";
import type { AdvertiserCheckResult } from "../particulares/idealista-advertiser-detector";

// Resultado de la extracción de una ficha pública. Mismo "shape" que
// NormalizedProperty del diff-engine, pero opcional en casi todos los
// campos: una ficha mal parseada se muestra al admin con los campos
// disponibles y los que falten se rellenan a mano en la preview.

export type ImportPortal =
  | "idealista"
  | "fotocasa"
  | "inmoweb"
  | "mobilia"
  | "clikalia"
  | "urbantechome"
  | "generic";

export type ImportPhoto = {
  url: string;
  alt?: string;
};

export type ImportPreview = {
  portal: ImportPortal;
  sourceUrl: string;
  // Sugerencia para `external_id`: hash determinista derivado del URL o
  // identificador real expuesto por el portal (`?adid=`, slug numérico, etc.).
  externalReference: string;
  title: string | null;
  description: string | null;
  operation: PropertyOperation | null;
  stay: PropertyStay | null;
  price: number | null;
  currency: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareMeters: number | null;
  zone: string | null;
  address: string | null;
  features: string[];
  // Coordenadas geográficas si el portal las expone (Idealista las trae en el
  // JSON embebido). Habilitan el feature de "distancia al campus".
  latitude: number | null;
  longitude: number | null;
  photos: ImportPhoto[];
  // Campos sin parsear pero potencialmente útiles para el admin. p.ej. "Año
  // construcción", "Planta", "Estado conservación".
  rawAttributes: Record<string, string | number | null>;
  // Mensajes informativos del extractor (qué no se pudo parsear). No son
  // errores — la preview se considera válida aunque haya warnings.
  warnings: string[];
  // Tipo de anunciante (solo Idealista). particular / professional / unknown.
  advertiserInfo?: AdvertiserCheckResult;
  // Multimedia extra de la ficha (si el portal los expone en el HTML):
  // plano de la vivienda y vídeo. null/undefined = no detectado.
  floorPlanUrl?: string | null;
  videoUrl?: string | null;
};

export type ImportExtractError =
  | { kind: "fetch_failed"; status: number; reason: string }
  | { kind: "blocked"; reason: string }
  | { kind: "unsupported_url"; reason: string }
  | { kind: "parse_failed"; reason: string };

export type ImportExtractResult =
  | { ok: true; preview: ImportPreview }
  | { ok: false; error: ImportExtractError };
