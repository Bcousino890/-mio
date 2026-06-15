import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PublicPropertyView } from "@/app/compartir/[slug]/public-property-view";
import { propertyRowToClientProperty } from "@/lib/db/adapters";
import type { PropertyRow } from "@/lib/db/row-types";
import {
  getPropertyByShareToken,
  recordShareOpen,
} from "@/lib/db/queries/shares";
import { getOrComputePropertyCoords } from "@/lib/geo/geocode";

export const dynamic = "force-dynamic";

const PORTAL_URL = (
  process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://portal.bcousinoprop.com"
).replace(/\/+$/, "");

function fmtPrice(price: number, isRent: boolean): string {
  const n = new Intl.NumberFormat("es-ES").format(price);
  return isRent ? `${n} €/mes` : `${n} €`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const data = await getPropertyByShareToken(token);
  if (!data) {
    return {
      title: "Enlace no disponible · Benjamín Cousiño Propiedades",
      robots: { index: false, follow: false },
    };
  }
  const p = data.property as unknown as PropertyRow;
  const isRent = p.operation === "rent";
  const title = `${p.title} · ${fmtPrice(Number(p.price), isRent)}`;
  const description = [
    `${p.bedrooms} hab · ${p.bathrooms} baños`,
    p.square_meters ? `${p.square_meters} m²` : null,
    p.zone,
    "Madrid",
  ]
    .filter(Boolean)
    .join(" · ");
  // Mismo endpoint OG JPEG 1200×630 que /compartir/[slug] — más compatible
  // que la imagen webp del Storage para WhatsApp/Twitter/etc.
  const ogImage = `${PORTAL_URL}/og/property/${p.slug}`;

  return {
    title,
    description,
    // Los SmartLinks personalizados NO se indexan: son únicos por envío.
    robots: { index: false, follow: false },
    metadataBase: new URL(PORTAL_URL),
    openGraph: {
      type: "website",
      title,
      description,
      siteName: "Benjamín Cousiño Propiedades",
      locale: "es_ES",
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          type: "image/jpeg",
          alt: p.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function TokenSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await getPropertyByShareToken(token);
  if (!resolved) notFound();

  // Registrar la apertura. Fire-and-forget para no bloquear el render.
  // No abortamos si falla — el cliente prioritario es el visitante.
  const reqHeaders = await headers();
  const ip =
    reqHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    reqHeaders.get("x-real-ip") ??
    null;
  const userAgent = reqHeaders.get("user-agent") ?? null;
  recordShareOpen({ shareId: resolved.shareId, ip, userAgent }).catch(() => {
    /* tracking opt-out silently */
  });

  const row = resolved.property as Parameters<
    typeof propertyRowToClientProperty
  >[0] & {
    id: string;
    address: string | null;
    zone: string;
    latitude: number | null;
    longitude: number | null;
  };

  // Geocoding cacheado (mismo flujo que /compartir/[slug]).
  const coords = await getOrComputePropertyCoords({
    propertyId: row.id,
    address: row.address,
    zone: row.zone,
    cachedLat: row.latitude,
    cachedLng: row.longitude,
  });

  const property = propertyRowToClientProperty(row);
  if (coords) {
    property.latitude = coords.lat;
    property.longitude = coords.lng;
  }
  return <PublicPropertyView property={property} />;
}
