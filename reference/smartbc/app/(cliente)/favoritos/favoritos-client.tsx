"use client";

import { ArrowRight, Heart } from "lucide-react";
import Link from "next/link";
import { PropertyCard } from "@/components/property-card";
import { SectionHeader } from "@/components/section-header";
import { PageFooter } from "@/components/ui/page-footer";
import { useT } from "@/lib/i18n/provider";
import type { Property } from "@/lib/types";

export function FavoritosClient({ properties }: { properties: Property[] }) {
  const t = useT();

  const countKey =
    properties.length === 0
      ? "favoritos.count.0"
      : properties.length === 1
        ? "favoritos.count.1"
        : "favoritos.count.n";

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-10 md:px-8">
      <SectionHeader
        titleKey="favoritos.title"
        subtitleKey="favoritos.subtitle"
      />

      {properties.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="mt-8 flex items-center gap-3">
            <Heart size={16} strokeWidth={1.75} className="text-gold" />
            <p className="text-sm text-gold-dark">
              {t(countKey, { count: properties.length })}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {properties.map((p) => (
              <PropertyCard
                key={p.id}
                property={p}
                variant="grid"
                isFavorite={true}
              />
            ))}
          </div>
        </>
      )}

      <PageFooter textKey="login.footer" />
    </div>
  );
}

function EmptyState() {
  const t = useT();
  return (
    <div className="mt-12 rounded-2xl border border-gold/25 bg-cream-50/85 p-12 text-center shadow-[0_15px_40px_-25px_rgba(40,28,10,0.30)] backdrop-blur-sm">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-gold/40 text-gold">
        <Heart size={20} strokeWidth={1.5} />
      </span>
      <p className="mt-4 font-serif text-lg text-ink">
        {t("favoritos.empty.title")}
      </p>
      <p className="mt-2 max-w-sm mx-auto text-sm text-ink/60">
        {t("favoritos.empty.text")}
      </p>
      <Link
        href="/propiedades"
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-2.5 text-sm font-medium text-cream-50 transition hover:bg-ink-soft"
      >
        <span>{t("favoritos.empty.cta")}</span>
        <ArrowRight size={14} strokeWidth={1.75} className="text-gold" />
      </Link>
    </div>
  );
}
