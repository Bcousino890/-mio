import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ImageGallery from "@/components/ImageGallery";
import InquiryForm from "@/components/InquiryForm";
import PropertyCard from "@/components/PropertyCard";
import {
  AreaIcon,
  BathIcon,
  BedIcon,
  CalendarIcon,
  MapPinIcon,
} from "@/components/icons";
import { formatPriceMulti } from "@/lib/currency";
import {
  getPropertyBySlug,
  getSimilarProperties,
  properties,
} from "@/lib/properties";

export function generateStaticParams() {
  return properties.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const property = getPropertyBySlug(slug);
  if (!property) return {};
  return {
    title: `${property.title} | Benjamín Cousiño Propiedades`,
    description: property.description,
  };
}

export default async function PropertyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const property = getPropertyBySlug(slug);
  if (!property) notFound();

  const similar = getSimilarProperties(property);

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
      <nav className="text-sm text-navy/50">
        <span>Propiedades</span> <span className="px-1">/</span>{" "}
        <span>
          {property.country === "ESPAÑA" ? "España" : "Chile"}
        </span>{" "}
        <span className="px-1">/</span>{" "}
        <span className="text-navy">{property.city}</span>
      </nav>

      <div className="mt-4 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            {property.isNew && (
              <span className="rounded-full bg-navy px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                Nueva
              </span>
            )}
            {property.offMarket && (
              <span className="rounded-full bg-gold px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                Off-Market
              </span>
            )}
          </div>
          <h1 className="font-serif-display mt-2 text-3xl text-navy sm:text-4xl">
            {property.title}
          </h1>
          <p className="mt-1 text-navy/60">
            {property.neighborhood}, {property.city}
          </p>
        </div>
        <p className="text-xl font-medium text-navy">
          {formatPriceMulti(property.price, property.currency)}
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-y border-navy/10 py-4 text-sm text-navy/80">
        <div className="flex items-center gap-2">
          <BedIcon className="h-5 w-5 text-gold" />
          <span>{property.bedrooms} habitaciones</span>
        </div>
        <div className="flex items-center gap-2">
          <BathIcon className="h-5 w-5 text-gold" />
          <span>{property.bathrooms} baños</span>
        </div>
        <div className="flex items-center gap-2">
          <AreaIcon className="h-5 w-5 text-gold" />
          <span>{property.area} m²</span>
        </div>
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-5 w-5 text-gold" />
          <span>Construida en {property.yearBuilt}</span>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-12 lg:grid-cols-[1fr_380px]">
        <div>
          <ImageGallery images={property.images} alt={property.title} />

          <section className="mt-10">
            <h2 className="font-serif-display text-2xl text-navy">
              Descripción
            </h2>
            <p className="mt-3 leading-relaxed text-navy/80">
              {property.description}
            </p>
          </section>

          <section className="mt-10">
            <h2 className="font-serif-display text-2xl text-navy">
              Especificaciones
            </h2>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {[
                ["Superficie construida", `${property.area} m²`],
                ...(property.landArea
                  ? [["Superficie de terreno", `${property.landArea} m²`]]
                  : []),
                ["Habitaciones", property.bedrooms],
                ["Baños", property.bathrooms],
                ["Año de construcción", property.yearBuilt],
                ...(property.architect
                  ? [["Arquitecto", property.architect]]
                  : []),
              ].map(([label, value]) => (
                <div
                  key={label as string}
                  className="rounded-md bg-cream p-4"
                >
                  <dt className="text-xs uppercase tracking-wide text-navy/50">
                    {label}
                  </dt>
                  <dd className="mt-1 font-medium text-navy">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="mt-10">
            <h2 className="font-serif-display text-2xl text-navy">
              Amenidades
            </h2>
            <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {property.amenities.map((amenity) => (
                <li
                  key={amenity}
                  className="flex items-center gap-2 rounded-md border border-navy/10 px-4 py-2.5 text-sm text-navy/80"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                  {amenity}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-10">
            <h2 className="font-serif-display text-2xl text-navy">
              Ubicación
            </h2>
            <p className="mt-2 max-w-xl text-sm text-navy/60">
              Por discreción con el propietario, mostramos un área
              aproximada. Le facilitaremos la dirección exacta al coordinar
              una visita privada.
            </p>
            <div className="relative mt-4 aspect-[16/7] w-full overflow-hidden rounded-lg bg-cream">
              <svg
                className="absolute inset-0 h-full w-full"
                preserveAspectRatio="none"
                viewBox="0 0 400 175"
              >
                {Array.from({ length: 9 }, (_, i) => (
                  <line
                    key={`v${i}`}
                    x1={i * 50}
                    y1="0"
                    x2={i * 50}
                    y2="175"
                    stroke="#0e2238"
                    strokeOpacity="0.06"
                  />
                ))}
                {Array.from({ length: 5 }, (_, i) => (
                  <line
                    key={`h${i}`}
                    x1="0"
                    y1={i * 44}
                    x2="400"
                    y2={i * 44}
                    stroke="#0e2238"
                    strokeOpacity="0.06"
                  />
                ))}
                <circle
                  cx="200"
                  cy="87"
                  r="70"
                  fill="#b08d57"
                  fillOpacity="0.08"
                  stroke="#b08d57"
                  strokeOpacity="0.4"
                />
                <circle
                  cx="200"
                  cy="87"
                  r="40"
                  fill="#b08d57"
                  fillOpacity="0.1"
                  stroke="#b08d57"
                  strokeOpacity="0.5"
                />
              </svg>
              <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1">
                <MapPinIcon className="h-7 w-7 text-navy" />
                <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-navy shadow-sm">
                  {property.neighborhood}, {property.city}
                </span>
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-lg border border-navy/10 p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-navy/50">
              Asesor
            </p>
            <p className="mt-2 text-lg font-medium text-navy">
              {property.agent.name}
            </p>
            <p className="text-sm text-navy/60">{property.agent.title}</p>

            <div className="mt-4 space-y-2 text-sm text-navy/80">
              <a
                href={`https://wa.me/${property.agent.whatsapp}`}
                className="block rounded-full bg-[#25D366] px-4 py-2 text-center font-medium text-white"
              >
                WhatsApp directo
              </a>
              <a
                href={`tel:${property.agent.phone}`}
                className="block rounded-full border border-navy/20 px-4 py-2 text-center font-medium text-navy"
              >
                {property.agent.phone}
              </a>
            </div>
          </div>

          <div className="rounded-lg border border-navy/10 p-6">
            <h3 className="font-serif-display text-lg text-navy">
              Consulta Privada
            </h3>
            <p className="mt-1 text-sm text-navy/60">
              Respuesta confidencial en menos de 24 horas.
            </p>
            <div className="mt-4">
              <InquiryForm
                propertySlug={property.slug}
                propertyTitle={property.title}
              />
            </div>
          </div>
        </aside>
      </div>

      <section className="mt-16 flex flex-wrap items-center gap-2 border-t border-navy/10 pt-8">
        <p className="mr-2 text-sm text-navy/60">
          Esta propiedad también aparece en:
        </p>
        {[
          {
            label: `${property.type} en ${
              property.country === "ESPAÑA" ? "España" : "Chile"
            }`,
            href: `/propiedades?country=${property.country}&type=${encodeURIComponent(
              property.type
            )}`,
          },
          {
            label: `${property.type} en venta`,
            href: `/propiedades?type=${encodeURIComponent(property.type)}`,
          },
          {
            label: `Propiedades en ${
              property.country === "ESPAÑA" ? "España" : "Chile"
            }`,
            href: `/propiedades?country=${property.country}`,
          },
        ].map((tag) => (
          <Link
            key={tag.href}
            href={tag.href}
            className="rounded-full border border-navy/20 px-3 py-1.5 text-xs font-medium text-navy transition-colors hover:border-navy"
          >
            {tag.label}
          </Link>
        ))}
      </section>

      {similar.length > 0 && (
        <section className="mt-16">
          <h2 className="font-serif-display text-2xl text-navy">
            Propiedades Similares
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {similar.map((p) => (
              <PropertyCard key={p.slug} property={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
