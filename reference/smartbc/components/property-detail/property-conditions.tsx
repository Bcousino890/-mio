"use client";

import { Award, ConciergeBell, ShieldCheck } from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import type { PropertyCondition, PropertyConditionKind } from "@/lib/types";

const ICONS: Record<PropertyConditionKind, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  deposit: ShieldCheck,
  guarantee: Award,
  personalShopper: ConciergeBell,
};

export function PropertyConditionsBlock({
  conditions,
}: {
  conditions: PropertyCondition[];
}) {
  const t = useT();

  return (
    <section className="rounded-2xl border border-gold/20 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.35)] backdrop-blur-sm md:p-6">
      <h2 className="font-serif text-2xl font-medium text-ink">
        {t("detail.conditions.title")}
      </h2>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        {conditions.map((c) => (
          <ConditionCard key={c.kind} condition={c} />
        ))}
      </div>
    </section>
  );
}

function ConditionCard({ condition }: { condition: PropertyCondition }) {
  const t = useT();
  const Icon = ICONS[condition.kind];
  const monthsLabel =
    condition.months === 1
      ? t("detail.conditions.month.singular")
      : t("detail.conditions.month.plural", { n: condition.months });

  return (
    <article className="flex gap-3 rounded-xl border border-gold/20 bg-white/60 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gold/40 text-gold">
        <Icon size={18} strokeWidth={1.5} />
      </span>
      <div className="min-w-0">
        <p className="font-serif text-sm font-semibold text-ink">
          {t(`detail.conditions.${condition.kind}.label`, {
            months: monthsLabel,
          })}
          {condition.kind === "personalShopper" && (
            <span className="ml-1 text-xs font-normal text-ink/55">
              {t("detail.conditions.personalShopper.sublabel")}
            </span>
          )}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink/65">
          {t(`detail.conditions.${condition.kind}.help`)}
        </p>
      </div>
    </article>
  );
}
