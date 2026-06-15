"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { PropertyCard } from "@/components/property-card";
import { useT } from "@/lib/i18n/provider";
import type { Property } from "@/lib/types";

export function RecommendedPropertiesBlock({
  properties,
}: {
  properties: Property[];
}) {
  const t = useT();

  return (
    <section className="rounded-2xl border border-gold/20 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.30)] backdrop-blur-sm md:p-6">
      <header className="flex items-center justify-between">
        <h2 className="font-serif text-2xl font-medium text-ink">
          {t("inicio.recommended.title")}
        </h2>
        <Link
          href="/propiedades"
          className="flex items-center gap-1.5 text-[12px] font-medium text-gold-dark transition hover:text-gold"
        >
          <span>{t("inicio.recommended.viewAll")}</span>
          <ArrowRight size={13} strokeWidth={1.75} />
        </Link>
      </header>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {properties.map((p) => (
          <div key={p.id} className="relative">
            <span className="absolute left-3 top-3 z-10 rounded-md bg-cream-50/95 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-gold-dark shadow-sm">
              {t("inicio.recommended.new")}
            </span>
            <PropertyCard property={p} variant="grid" />
          </div>
        ))}
      </div>
    </section>
  );
}
