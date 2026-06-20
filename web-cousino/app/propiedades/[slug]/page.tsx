import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ImageGallery from "@/components/ImageGallery";
import InquiryForm from "@/components/InquiryForm";
import PropertyCard from "@/components/PropertyCard";
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
        </div>

        <aside className="space-y-6">
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
