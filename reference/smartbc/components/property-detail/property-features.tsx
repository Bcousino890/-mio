"use client";

import {
  Armchair,
  ArrowUpDown,
  BellRing,
  Building,
  Car,
  ChefHat,
  Sun,
  TreePalm,
  Waves,
  Wind,
} from "lucide-react";
import { useT } from "@/lib/i18n/provider";
import type { PropertyFeature } from "@/lib/types";

const ICONS: Record<
  PropertyFeature,
  React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
> = {
  exterior: Sun,
  furnished: Armchair,
  balcony: Building,
  terrace: TreePalm,
  elevator: ArrowUpDown,
  equippedKitchen: ChefHat,
  garage: Car,
  pool: Waves,
  doorman: BellRing,
  airConditioning: Wind,
};

export function PropertyFeaturesBlock({
  features,
}: {
  features: PropertyFeature[];
}) {
  const t = useT();

  return (
    <section className="rounded-2xl border border-gold/20 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.35)] backdrop-blur-sm md:p-6">
      <h2 className="font-serif text-2xl font-medium text-ink">
        {t("detail.features.title")}
      </h2>

      <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-5">
        {features.map((f) => {
          const Icon = ICONS[f];
          return (
            <li key={f} className="flex flex-col items-center gap-2 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-gold/40 text-gold">
                <Icon size={20} strokeWidth={1.5} />
              </span>
              <span className="text-xs font-medium text-ink/75">
                {t(`detail.features.${f}`)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
