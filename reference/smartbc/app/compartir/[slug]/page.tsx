import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { propertyRowToClientProperty } from "@/lib/db/adapters";
import {
  getPropertyBySlugPublic,
  resolveLegacySlug,
} from "@/lib/db/queries/properties";
import { getOrComputePropertyCoords } from "@/lib/geo/geocode";
import { PublicPropertyView } from "./public-property-view";

export const dynamic = "force-dynamic";

// URL base pública del portal para construir URLs absolutas en OG/canonical.
// Caemos al dominio de producción si no hay env explícito.
const PORTAL_URL = (
  process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://portal.bcousinoprop.com"
).replace(/\/+$/, "");

function formatPriceForOg(price: number, isRent: boolean): string {
  const n = new Intl.NumberFormat("es-ES").format(price);
  return isRent ? `${n} €/mes` : `${n} €`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const row = (await getPropertyBySlugPublic(slug)) as
    | {
        title: string;
        operation: "rent" | "sale";
        price: number;
        zone: string;
        bedrooms: number;
        bathrooms: number;
        square_meters: number | null;
        cover_photo_url: string | null;
        property_photos:
          | Array<{ url: string; is_cover: boolean }>
          | null;
      }
    | null;
  if (!row) {
    return { title: "Propiedad no disponible · Benjamín Cousiño Propiedades" };
  }

  const isRent = row.operation === "rent";
  const price = formatPriceForOg(Number(row.price), isRent);
  const title = `${row.title} · ${price}`;
  const description = [
    `${row.bedrooms} hab · ${row.bathrooms} baños`,
    row.square_meters ? `${row.square_meters} m²` : null,
    row.zone,
    "Madrid",
  ]
    .filter(Boolean)
    .join(" · ");

  // OG image: usamos un endpoint dedicado que sirve la foto principal
  // como JPEG 1200×630 (formato más compatible que WebP para WhatsApp,
  // Twitter, Slack, etc.). El endpoint cachea por 24h.
  const ogImage = `${PORTAL_URL}/og/property/${slug}`;
  const canonical = `${PORTAL_URL}/compartir/${slug}`;

  return {
    title,
    description,
    metadataBase: new URL(PORTAL_URL),
    alternates: { canonical },
    openGraph: {
      type: "website",
      url: canonical,
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
          alt: row.title,
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

export default async function PublicSharePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Bypasa RLS con service role (visitante no autenticado).
  const row = (await getPropertyBySlugPublic(slug)) as
    | (Parameters<typeof propertyRowToClientProperty>[0] & {
        id: string;
        address: string | null;
        zone: string;
        latitude: number | null;
        longitude: number | null;
        property_media?: Array<{
          url: string;
          file_name?: string | null;
          type?: string | null;
        }> | null;
      })
    | null;
  if (!row) {
    // Slug viejo (con prefijo de agencia, ej. "level-…"): redirigimos al
    // nuevo para no romper SmartLinks ya enviados a clientes.
    const newSlug = await resolveLegacySlug(slug);
    if (newSlug && newSlug !== slug) {
      redirect(`/compartir/${newSlug}`);
    }
    notFound();
  }

  // Geocoding cacheado: en el primer acceso resuelve y guarda; en los
  // siguientes devuelve las coords ya guardadas. Si falla devuelve null
  // y la vista cae al fallback por barrio.
  const coords = await getOrComputePropertyCoords({
    propertyId: row.id,
    address: row.address,
    zone: row.zone,
    cachedLat: row.latitude,
    cachedLng: row.longitude,
  });

  const property = propertyRowToClientProperty(row);
  // Si geocoding devolvió coords pero el adapter aún no las tenía
  // (porque acabamos de cachearlas), las ponemos aquí.
  if (coords) {
    property.latitude = coords.lat;
    property.longitude = coords.lng;
  }

  // Videos y planos subidos desde /admin/publicacion (tabla property_media).
  const media = row.property_media ?? [];
  const videos = media
    .filter((m) => m.type === "video" && m.url)
    .map((m) => ({ url: m.url, file_name: m.file_name ?? null }));
  const plans = media
    .filter((m) => m.type === "plan" && m.url)
    .map((m) => ({ url: m.url, file_name: m.file_name ?? null }));

  return (
    <PublicPropertyView property={property} videos={videos} plans={plans} />
  );
}
