"use client";

import { useT } from "@/lib/i18n/provider";
import type { PropertySpecs } from "@/lib/types";

export function PropertySpecsBlock({ specs }: { specs: PropertySpecs }) {
  const t = useT();

  const rows: { label: string; value: string }[] = [];

  if (specs.type) {
    rows.push({
      label: t("detail.specs.type"),
      value: t(`detail.specs.type.${specs.type}`),
    });
  }
  if (specs.state) {
    rows.push({
      label: t("detail.specs.state"),
      value: t(`detail.specs.state.${specs.state}`),
    });
  }
  if (specs.floor) {
    rows.push({
      label: t("detail.specs.floor"),
      value: specs.floor,
    });
  }
  if (specs.heating) {
    rows.push({
      label: t("detail.specs.heating"),
      value: t(`detail.specs.heating.${specs.heating}`),
    });
  }
  if (specs.airConditioning) {
    rows.push({
      label: t("detail.specs.airConditioning"),
      value: t(`detail.specs.ac.${specs.airConditioning}`),
    });
  }
  if (specs.energyCertificate) {
    rows.push({
      label: t("detail.specs.energyCertificate"),
      value:
        specs.energyCertificate === "pending"
          ? t("detail.specs.ec.pending")
          : specs.energyCertificate,
    });
  }

  if (rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-gold/20 bg-cream-50/85 p-5 shadow-[0_15px_40px_-25px_rgba(40,28,10,0.35)] backdrop-blur-sm md:p-6">
      <ul className="divide-y divide-gold/15">
        {rows.map((row) => (
          <li
            key={row.label}
            className="flex items-center justify-between gap-4 py-2.5 text-sm"
          >
            <span className="text-ink/60">{row.label}</span>
            <span className="text-right font-medium text-ink">{row.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
