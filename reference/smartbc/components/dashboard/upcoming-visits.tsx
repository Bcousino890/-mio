"use client";

import { ArrowRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import { PLACEHOLDER_GRADIENT } from "@/lib/constants";
import { useT } from "@/lib/i18n/provider";
import type { Visit } from "@/lib/types";

export function UpcomingVisitsBlock({ visits }: { visits: Visit[] }) {
  const t = useT();

  return (
    <section className="flex flex-col rounded-2xl border border-gold/20 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.30)] backdrop-blur-sm md:p-6">
      <header className="flex items-center justify-between">
        <h2 className="font-serif text-xl font-medium text-ink">
          {t("inicio.visits.title")}
        </h2>
        <Link
          href="/inicio"
          className="flex items-center gap-1.5 text-[12px] font-medium text-gold-dark transition hover:text-gold"
        >
          <span>{t("inicio.visits.viewAll")}</span>
          <ArrowRight size={13} strokeWidth={1.75} />
        </Link>
      </header>

      <ul className="mt-4 flex-1 space-y-3">
        {visits.map((visit) => (
          <li key={visit.id}>
            <Link
              href={`/propiedades/${visit.propertyId}`}
              className="flex items-stretch gap-3 rounded-xl border border-gold/15 bg-white/55 p-2 transition hover:border-gold/40 hover:bg-white/75"
            >
              {/* Date pill */}
              <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-cream-100/85 py-2 text-center">
                <span className="text-[10px] font-semibold tracking-wider text-gold-dark">
                  {visit.monthLabel}
                </span>
                <span className="font-serif text-xl font-semibold text-ink">
                  {visit.dayLabel}
                </span>
              </div>

              {/* Thumbnail */}
              <div
                aria-hidden="true"
                className="hidden h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-cream-200 sm:block"
                style={{ backgroundImage: PLACEHOLDER_GRADIENT }}
              />

              {/* Info */}
              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <p className="text-[11px] font-medium text-ink/55">
                  {visit.time}
                </p>
                <p className="truncate font-serif text-sm font-semibold text-ink">
                  {visit.propertyTitle}
                </p>
                <p className="truncate text-[11px] text-ink/55">
                  {visit.street}
                </p>
                <p className="truncate text-[11px] text-ink/55">
                  {visit.postalCode}
                </p>
              </div>

              <ChevronRight
                size={16}
                strokeWidth={1.75}
                className="self-center text-ink/35"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>

      <Link
        href="/inicio"
        className="mt-4 flex items-center justify-center rounded-xl border border-gold/30 py-2.5 text-[12px] font-medium text-ink/70 transition hover:bg-white/60 hover:text-ink"
      >
        {t("inicio.visits.viewMine")}
      </Link>
    </section>
  );
}
