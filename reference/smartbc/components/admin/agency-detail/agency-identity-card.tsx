"use client";

import { Calendar, MapPin, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import { formatRelativeMinutes } from "@/lib/relative-time";
import type { AgencyDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AgencyIdentityCard({ agency }: { agency: AgencyDetail }) {
  const t = useT();
  const isActive = agency.status === "active";

  return (
    <section className="rounded-2xl border border-gold/15 bg-cream-50/85 p-6 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.25)] backdrop-blur-sm md:p-7">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[auto_1fr_auto] md:items-start">
        {/* Logo circle */}
        <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-ink font-serif text-base font-medium tracking-[0.18em] text-cream-50 shadow-md md:h-32 md:w-32">
          {agency.initials}
        </div>

        {/* Identity */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-3xl font-medium leading-tight text-ink md:text-4xl">
              {agency.name}
            </h1>
            <span
              className={cn(
                "rounded-full border px-3 py-0.5 text-[12px] font-medium",
                isActive
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-ink/15 bg-ink/5 text-ink/55",
              )}
            >
              {t(`agency.status.${agency.status}`)}
            </span>
          </div>

          <div className="mt-3 space-y-1.5 text-sm text-ink/65">
            <p className="flex items-center gap-2">
              <MapPin size={14} strokeWidth={1.75} className="text-gold" />
              <span>
                {t("agency.location", {
                  city: agency.city,
                  country: agency.country,
                })}
              </span>
            </p>
            <p className="flex items-center gap-2">
              <Calendar size={14} strokeWidth={1.75} className="text-gold" />
              <span>
                {t("agency.partnerSince", { date: agency.partnerSinceLabel })}
              </span>
            </p>
          </div>
        </div>

        {/* Last update */}
        <p className="flex items-center gap-1.5 text-[12px] text-ink/55 md:self-start md:pt-2">
          <RefreshCw size={13} strokeWidth={1.75} className="text-gold" />
          <span>{t("admin.lastUpdate.label")}</span>
          <span>{formatRelativeMinutes(agency.lastUpdateMinutes, t)}</span>
        </p>
      </div>
    </section>
  );
}
