"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { formatPrice } from "@/lib/format";
import { useT } from "@/lib/i18n/provider";
import type { Property } from "@/lib/types";

const PHOTO_GRADIENT =
  "linear-gradient(135deg,#1a1a1a 0%,#2a2419 35%,#5a4a30 100%)";

export function RecommendationCard({ property }: { property: Property }) {
  const t = useT();

  return (
    <section className="relative flex h-full min-h-[330px] flex-col overflow-hidden rounded-2xl border border-gold/20 shadow-[0_20px_50px_-25px_rgba(40,28,10,0.45)]">
      {/* Photo placeholder */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ backgroundImage: PHOTO_GRADIENT }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(255,235,190,0.18),transparent_60%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[65%] bg-[linear-gradient(to_top,rgba(0,0,0,0.85)_0%,rgba(0,0,0,0.55)_55%,transparent_100%)]"
      />

      {/* Header bar */}
      <div className="relative flex items-center justify-between p-4">
        <h2 className="font-serif text-lg font-medium text-cream-50 drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]">
          {t("inicio.recommendations.title")}
        </h2>
        <div className="flex items-center gap-1.5">
          <CarouselButton label={t("inicio.recommendations.previous")}>
            <ChevronLeft size={15} strokeWidth={1.75} />
          </CarouselButton>
          <CarouselButton label={t("inicio.recommendations.next")}>
            <ChevronRight size={15} strokeWidth={1.75} />
          </CarouselButton>
        </div>
      </div>

      {/* Content at the bottom */}
      <div className="relative mt-auto flex flex-col gap-2 p-4 md:p-5">
        <h3 className="font-serif text-2xl font-medium text-cream-50 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]">
          {property.title}
        </h3>
        <p className="text-[12px] text-cream-50/85">
          {t("card.unit.bedrooms", { n: property.bedrooms })} ·{" "}
          {t("card.unit.bathrooms", { n: property.bathrooms })} ·{" "}
          {t("card.unit.area", { n: property.squareMeters })}
        </p>
        <p className="font-serif text-2xl font-semibold text-cream-50">
          {formatPrice(property.price)} €
        </p>
        <Link
          href={`/propiedades/${property.id}`}
          className="mt-2 w-fit rounded-lg bg-gold px-4 py-2 text-[12px] font-semibold text-ink transition hover:bg-gold-light"
        >
          {t("card.action.view")}
        </Link>
      </div>
    </section>
  );
}

function CarouselButton({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-cream-50/30 bg-cream-50/15 text-cream-50 backdrop-blur-sm transition hover:bg-cream-50/25"
    >
      {children}
    </button>
  );
}

