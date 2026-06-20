import Image from "next/image";
import Link from "next/link";
import type { Property } from "@/lib/properties";
import PriceDisplay from "@/components/PriceDisplay";

export default function PropertyCard({ property }: { property: Property }) {
  return (
    <Link
      href={`/propiedades/${property.slug}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-navy/10 transition-shadow hover:shadow-xl"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-navy/5">
        <Image
          src={property.images[0]}
          alt={property.title}
          fill
          className="object-cover transition-transform duration-500 group-hover:scale-105"
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
        />
        <div className="absolute left-3 top-3 flex gap-2">
          {property.isNew && (
            <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-navy">
              Nueva
            </span>
          )}
          {property.offMarket && (
            <span className="rounded-full bg-gold/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
              Off-Market
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-5">
        <p className="text-sm font-medium text-gold">
          {property.city}, {property.country === "ESPAÑA" ? "España" : "Chile"}
        </p>
        <h3 className="font-serif-display text-lg leading-snug text-navy">
          {property.title}
        </h3>
        <p className="text-sm text-navy/70">
          <PriceDisplay amount={property.price} currency={property.currency} />
        </p>
        <div className="mt-2 flex gap-4 text-sm text-navy/60">
          <span>{property.bedrooms} hab.</span>
          <span>{property.bathrooms} baños</span>
          <span>{property.area} m²</span>
        </div>
      </div>
    </Link>
  );
}
