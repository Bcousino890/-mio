"use client";

import { Sparkles } from "lucide-react";
import { SectionHeader } from "@/components/section-header";
import { useT } from "@/lib/i18n/provider";

export function ComingSoon({
  titleKey,
  subtitleKey,
  descriptionKey,
}: {
  titleKey: string;
  subtitleKey?: string;
  descriptionKey?: string;
}) {
  const t = useT();
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-10 md:px-8">
      <SectionHeader titleKey={titleKey} subtitleKey={subtitleKey} />

      <div className="mt-12 flex flex-1 items-center justify-center">
        <div className="rounded-2xl border border-gold/25 bg-cream-50/85 px-10 py-12 text-center shadow-[0_20px_60px_-25px_rgba(40,28,10,0.35)] backdrop-blur-sm">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-gold/40 text-gold">
            <Sparkles size={20} strokeWidth={1.5} />
          </span>
          <p className="mt-4 font-serif text-xl text-ink">
            {t("comingSoon.title")}
          </p>
          <p className="mt-2 max-w-sm text-sm text-ink/60">
            {t(descriptionKey ?? "comingSoon.default")}
          </p>
        </div>
      </div>
    </div>
  );
}
