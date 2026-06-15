"use client";

import { KeyRound } from "lucide-react";
import Image from "next/image";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useT } from "@/lib/i18n/provider";

export function SectionHeader({
  titleKey,
  titleVars,
  subtitleKey,
}: {
  titleKey: string;
  titleVars?: Record<string, string | number>;
  subtitleKey?: string;
}) {
  const t = useT();
  return (
    <header className="relative">
      <div className="flex items-start justify-end pt-6 md:pt-8">
        <LanguageSwitcher />
      </div>

      <div className="-mt-9 flex flex-col items-center md:-mt-11">
        <Image
          src="/logo.png"
          alt="Benjamín Cousiño Propiedades"
          width={420}
          height={Math.round(420 * (519 / 3282))}
          priority
          className="h-auto w-[260px] select-none drop-shadow-[0_2px_8px_rgba(248,243,233,0.85)] md:w-[360px]"
        />
      </div>

      <div className="mt-6 flex flex-col items-center text-center md:mt-8">
        <KeyRound size={20} strokeWidth={1.5} className="text-gold" aria-hidden="true" />
        <span className="mt-1.5 h-px w-8 bg-gold/60" />
        <h1 className="mt-3 font-serif text-3xl font-medium leading-tight tracking-tight text-ink drop-shadow-[0_1px_6px_rgba(248,243,233,0.7)] md:text-4xl">
          {t(titleKey, titleVars)}
        </h1>
        {subtitleKey && (
          <p className="mt-2 max-w-xl text-sm text-ink/70 drop-shadow-[0_1px_4px_rgba(248,243,233,0.6)]">
            {t(subtitleKey)}
          </p>
        )}
      </div>
    </header>
  );
}
