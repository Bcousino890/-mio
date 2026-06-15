"use client";

import { ArrowRight, Bath, Bed, Euro, Heart, Maximize2 } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { toggleFavorite } from "@/app/(cliente)/actions";
import { RequestVisitModal } from "@/components/property-detail/request-visit-modal";
import { formatPropertyPrice } from "@/lib/format";
import { useT } from "@/lib/i18n/provider";
import type { Property } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PropertyHeaderCard({
  property,
  isFavorite = false,
}: {
  property: Property;
  isFavorite?: boolean;
}) {
  const t = useT();
  const [, startTransition] = useTransition();
  const [optimisticFav, applyOptimistic] = useOptimistic(
    isFavorite,
    (_, next: boolean) => next,
  );
  const [visitOpen, setVisitOpen] = useState(false);

  const handleFavorite = () => {
    const next = !optimisticFav;
    startTransition(async () => {
      applyOptimistic(next);
      const result = await toggleFavorite({ slug: property.id });
      if (!result.ok) applyOptimistic(!next);
    });
  };

  return (
    <div className="rounded-2xl border border-gold/20 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.35)] backdrop-blur-sm md:p-6">
      <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-[1fr_auto]">
        <div>
          <h1 className="font-serif text-3xl font-medium leading-tight text-ink md:text-4xl">
            {property.title}
          </h1>
          <p className="mt-1 text-sm text-ink/55">
            {property.zone}, {property.city}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleFavorite}
            aria-label={
              optimisticFav
                ? t("card.favorite.remove")
                : t("card.favorite.add")
            }
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-gold/25 bg-white/80 text-ink/60 transition hover:border-gold/50 hover:text-ink"
          >
            <Heart
              size={18}
              strokeWidth={1.75}
              className={cn(
                "transition",
                optimisticFav && "fill-rose-500 text-rose-500",
              )}
            />
          </button>
          <button
            type="button"
            onClick={() => setVisitOpen(true)}
            className="flex items-center gap-3 rounded-xl bg-ink px-5 py-3 text-sm font-medium tracking-wide text-cream-50 transition hover:bg-ink-soft"
          >
            <span>{t("detail.requestVisit")}</span>
            <ArrowRight size={16} strokeWidth={1.75} className="text-gold" />
          </button>
        </div>
      </div>

      <ul className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-gold/15 pt-4 text-sm text-ink/75">
        <Stat
          icon={<Bed size={16} strokeWidth={1.5} />}
          value={t("card.unit.bedrooms", { n: property.bedrooms })}
        />
        <Stat
          icon={<Bath size={16} strokeWidth={1.5} />}
          value={t("card.unit.bathrooms", { n: property.bathrooms })}
        />
        <Stat
          icon={<Maximize2 size={16} strokeWidth={1.5} />}
          value={t("card.unit.area", { n: property.squareMeters })}
        />
        <Stat
          icon={<Euro size={16} strokeWidth={1.5} />}
          value={formatPropertyPrice(property, t)}
        />
        <span className="ml-auto rounded-md bg-cream-100/70 px-3 py-1 text-[12px] font-medium text-ink/65">
          {t(
            `card.stay.${property.stayType === "corta" ? "short" : "long"}`,
          )}
        </span>
      </ul>

      <RequestVisitModal
        open={visitOpen}
        onClose={() => setVisitOpen(false)}
        propertySlug={property.id}
        propertyTitle={property.title}
      />
    </div>
  );
}

function Stat({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className="text-gold">{icon}</span>
      <span>{value}</span>
    </li>
  );
}
