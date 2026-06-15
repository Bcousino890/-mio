"use client";

import { ArrowLeft, KeyRound } from "lucide-react";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  PropertyCalendarCard,
  PropertyMapCard,
} from "@/components/property-detail/property-availability";
import { PropertyContactBlock } from "@/components/property-detail/property-contact";
import { PropertyConditionsBlock } from "@/components/property-detail/property-conditions";
import { PropertyFeaturesBlock } from "@/components/property-detail/property-features";
import { PropertyGallery } from "@/components/property-detail/property-gallery";
import { PropertyHeaderCard } from "@/components/property-detail/property-header-card";
import { PropertySpecsBlock } from "@/components/property-detail/property-specs";
import { PropertyUniversityDistance } from "@/components/property-detail/property-university-distance";
import { PageFooter } from "@/components/ui/page-footer";
import { useT } from "@/lib/i18n/provider";
import type { Property } from "@/lib/types";

export function PropertyDetail({
  property,
  isFavorite = false,
}: {
  property: Property;
  isFavorite?: boolean;
}) {
  const t = useT();

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-10 md:px-8">
      {/* Top bar: breadcrumb + language + small key icon */}
      <div className="flex items-start justify-between pt-6 md:pt-8">
        <nav
          aria-label="breadcrumb"
          className="text-sm text-ink/55 drop-shadow-[0_1px_4px_rgba(248,243,233,0.6)]"
        >
          <Link href="/propiedades" className="transition hover:text-ink">
            {t("detail.breadcrumb.properties")}
          </Link>
          <span className="mx-2 text-ink/30">/</span>
          <span className="text-ink">{t("detail.breadcrumb.detail")}</span>
        </nav>
        <LanguageSwitcher />
      </div>

      <div className="mt-3 flex justify-center">
        <KeyRound
          size={20}
          strokeWidth={1.5}
          className="text-gold"
          aria-hidden="true"
        />
      </div>

      <div className="mt-3">
        <Link
          href="/propiedades"
          className="inline-flex items-center gap-2 text-sm text-gold-dark transition hover:text-gold"
        >
          <ArrowLeft size={15} strokeWidth={1.75} />
          <span>{t("detail.back")}</span>
        </Link>
      </div>

      {/* Gallery */}
      <div className="mt-5">
        <PropertyGallery property={property} />
      </div>

      {/* Header card with title + stats + actions */}
      <div className="mt-5">
        <PropertyHeaderCard property={property} isFavorite={isFavorite} />
      </div>

      {/* Two columns: main (description + conditions + features) and aside (contact + specs) */}
      <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-5">
          {property.longDescription && (
            <section className="rounded-2xl border border-gold/20 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.35)] backdrop-blur-sm md:p-6">
              <h2 className="font-serif text-2xl font-medium text-ink">
                {t("detail.description.title")}
              </h2>
              <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink/75">
                {property.longDescription
                  .split(/\n\n+/)
                  .map((paragraph, i) => (
                    <p key={i}>{paragraph}</p>
                  ))}
              </div>
            </section>
          )}

          {property.conditions && property.conditions.length > 0 && (
            <PropertyConditionsBlock conditions={property.conditions} />
          )}

          {property.features && property.features.length > 0 && (
            <PropertyFeaturesBlock features={property.features} />
          )}

          <PropertyMapCard property={property} />

          {/* Distancia al campus: solo se muestra si la propiedad tiene
              coordenadas. Las nuevas importaciones (Idealista) las popúan
              automáticamente; las propiedades antiguas necesitan que el
              admin las añada para que esta sección aparezca. */}
          {typeof property.latitude === "number" &&
            typeof property.longitude === "number" && (
              <PropertyUniversityDistance
                propertyTitle={property.title}
                propertyLat={property.latitude}
                propertyLng={property.longitude}
              />
            )}
        </div>

        <aside className="flex flex-col gap-5">
          {property.contact && (
            <PropertyContactBlock contact={property.contact} />
          )}
          {property.specs && <PropertySpecsBlock specs={property.specs} />}
          <PropertyCalendarCard />
        </aside>
      </div>

      <PageFooter textKey="detail.footer" />
    </div>
  );
}
