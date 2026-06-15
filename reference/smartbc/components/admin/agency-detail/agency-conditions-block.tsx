"use client";

import {
  ClipboardCheck,
  FileText,
  Handshake,
  Percent,
  Users,
} from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import type { AgencyConditionKind } from "@/lib/types";

const ICONS: Record<
  AgencyConditionKind,
  React.ComponentType<{
    size?: number;
    strokeWidth?: number;
    className?: string;
  }>
> = {
  sharedCapture: Handshake,
  coordinatedVisits: Users,
  operationCommission: Percent,
  verifiedDocumentation: ClipboardCheck,
};

export function AgencyConditionsBlock({
  conditions,
}: {
  conditions: AgencyConditionKind[];
}) {
  const t = useT();
  return (
    <section className="rounded-2xl border border-gold/15 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.20)] backdrop-blur-sm md:p-6">
      <header className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55">
        <FileText size={13} strokeWidth={1.75} className="text-gold" />
        <span>{t("agency.conditions.title")}</span>
      </header>

      <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
        {conditions.map((c) => {
          const Icon = ICONS[c];
          return (
            <article key={c} className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
                <Icon size={18} strokeWidth={1.5} />
              </span>
              <div className="min-w-0">
                <p className="font-serif text-sm font-semibold text-ink">
                  {t(`agency.conditions.${c}.title`)}
                </p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink/65">
                  {t(`agency.conditions.${c}.text`)}
                </p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
