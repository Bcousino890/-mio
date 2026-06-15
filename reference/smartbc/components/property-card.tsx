"use client";

import { ArrowRight, Bath, Bed, Euro, Heart, Maximize2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { toggleFavorite } from "@/app/(cliente)/actions";
import { PLACEHOLDER_GRADIENT } from "@/lib/constants";
import { formatPropertyPrice } from "@/lib/format";
import { useT } from "@/lib/i18n/provider";
import type { Property, PropertyBadge } from "@/lib/types";
import { cn } from "@/lib/utils";

const BADGE_KEYS: Record<PropertyBadge, string> = {
  exclusiva: "card.badge.exclusive",
  destacada: "card.badge.featured",
  premium: "card.badge.premium",
};

type Props = {
  property: Property;
  variant?: "grid" | "list";
  isFavorite?: boolean;
};

export function PropertyCard({
  property,
  variant = "grid",
  isFavorite = false,
}: Props) {
  if (variant === "list")
    return <PropertyCardList property={property} isFavorite={isFavorite} />;
  return <PropertyCardGrid property={property} isFavorite={isFavorite} />;
}

function PropertyCardGrid({
  property,
  isFavorite,
}: {
  property: Property;
  isFavorite: boolean;
}) {
  const t = useT();
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-gold/20 bg-cream-50/85 shadow-[0_15px_40px_-20px_rgba(40,28,10,0.30)] backdrop-blur-sm transition hover:shadow-[0_25px_60px_-25px_rgba(40,28,10,0.45)]">
      <CoverImage property={property} isFavorite={isFavorite} />
      <div className="flex flex-1 flex-col gap-3 p-4 md:p-5">
        <div>
          <h3 className="font-serif text-lg font-medium text-ink">
            {property.title}
          </h3>
          <p className="mt-0.5 text-xs text-ink/55">
            {property.zone}, {property.city}
          </p>
        </div>

        <Stats property={property} />

        <div className="mt-auto flex items-center justify-between gap-3 pt-2">
          <span className="rounded-md bg-cream-100/70 px-2.5 py-1 text-[11px] font-medium text-ink/65">
            {t(`card.stay.${property.stayType === "corta" ? "short" : "long"}`)}
          </span>
          <SeeProperty href={`/propiedades/${property.id}`} />
        </div>
      </div>
    </article>
  );
}

function PropertyCardList({
  property,
  isFavorite,
}: {
  property: Property;
  isFavorite: boolean;
}) {
  const t = useT();
  return (
    <article className="group grid grid-cols-1 overflow-hidden rounded-2xl border border-gold/20 bg-cream-50/85 shadow-[0_15px_40px_-20px_rgba(40,28,10,0.30)] backdrop-blur-sm transition hover:shadow-[0_25px_60px_-25px_rgba(40,28,10,0.45)] md:grid-cols-[1.1fr_1fr]">
      <CoverImage
        property={property}
        isFavorite={isFavorite}
        className="md:h-full"
      />
      <div className="flex flex-col gap-3 p-5 md:p-6">
        <div>
          <h3 className="font-serif text-xl font-medium text-ink">
            {property.title}
          </h3>
          <p className="mt-0.5 text-sm text-ink/55">
            {property.zone}, {property.city}
          </p>
        </div>

        <Stats property={property} />

        <span className="w-fit rounded-md bg-cream-100/70 px-2.5 py-1 text-[11px] font-medium text-ink/65">
          {t(`card.stay.${property.stayType === "corta" ? "short" : "long"}`)}
        </span>

        {property.description && (
          <p className="text-sm leading-relaxed text-ink/70">
            {property.description}
          </p>
        )}

        <div className="mt-auto flex justify-end">
          <SeeProperty href={`/propiedades/${property.id}`} />
        </div>
      </div>
    </article>
  );
}

function CoverImage({
  property,
  isFavorite,
  className,
}: {
  property: Property;
  isFavorite: boolean;
  className?: string;
}) {
  const t = useT();
  const cover = property.image ?? property.photos?.[0];
  return (
    <div
      className={cn(
        "relative aspect-[4/3] w-full overflow-hidden bg-cream-200",
        className,
      )}
    >
      {cover ? (
        <Image
          src={cover}
          alt={property.title}
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover"
        />
      ) : (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{ backgroundImage: PLACEHOLDER_GRADIENT }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_30%,rgba(255,235,190,0.55),transparent_60%)]"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_80%,rgba(40,28,10,0.35),transparent_60%)]"
          />
        </>
      )}

      <FavoriteButton propertySlug={property.id} initialActive={isFavorite} />

      {property.badge && (
        <span className="absolute bottom-3 left-3 rounded-md bg-cream-50/95 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-gold-dark shadow-sm">
          {t(BADGE_KEYS[property.badge])}
        </span>
      )}
    </div>
  );
}

function FavoriteButton({
  propertySlug,
  initialActive,
}: {
  propertySlug: string;
  initialActive: boolean;
}) {
  const t = useT();
  const [, startTransition] = useTransition();
  // Optimistic UI: el corazón cambia al instante, el server confirma después.
  const [optimisticActive, applyOptimistic] = useOptimistic(
    initialActive,
    (_, next: boolean) => next,
  );

  const handleClick = () => {
    const next = !optimisticActive;
    startTransition(async () => {
      applyOptimistic(next);
      const result = await toggleFavorite({ slug: propertySlug });
      if (!result.ok) {
        // Revertir si falló: aplicar el valor opuesto al optimista.
        applyOptimistic(!next);
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={
        optimisticActive ? t("card.favorite.remove") : t("card.favorite.add")
      }
      className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-cream-50/90 text-ink shadow-sm transition hover:bg-cream-50"
    >
      <Heart
        size={16}
        strokeWidth={1.75}
        className={cn(
          "transition",
          optimisticActive ? "fill-rose-500 text-rose-500" : "text-ink/60",
        )}
      />
    </button>
  );
}

function Stats({ property }: { property: Property }) {
  const t = useT();
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-y border-gold/15 py-2.5 text-xs text-ink/75">
      <Stat
        icon={<Bed size={14} strokeWidth={1.5} />}
        value={t("card.unit.bedrooms", { n: property.bedrooms })}
      />
      <Stat
        icon={<Bath size={14} strokeWidth={1.5} />}
        value={t("card.unit.bathrooms", { n: property.bathrooms })}
      />
      <Stat
        icon={<Maximize2 size={14} strokeWidth={1.5} />}
        value={t("card.unit.area", { n: property.squareMeters })}
      />
      <Stat
        icon={<Euro size={14} strokeWidth={1.5} />}
        value={formatPropertyPrice(property, t)}
      />
    </ul>
  );
}

function Stat({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className="text-gold">{icon}</span>
      <span>{value}</span>
    </li>
  );
}

function SeeProperty({ href }: { href: string }) {
  const t = useT();
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-xs font-medium text-cream-50 transition hover:bg-ink-soft"
    >
      <span>{t("card.action.view")}</span>
      <ArrowRight size={14} strokeWidth={1.75} className="text-gold" />
    </Link>
  );
}
