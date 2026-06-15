"use client";

import { ChevronDown, Globe } from "lucide-react";
import { useState } from "react";
import { LANGUAGES, type Lang } from "@/lib/i18n/dictionary";
import { useLanguage, useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

export function LanguageSwitcher() {
  const t = useT();
  const { lang, setLang } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-3">
      <span className="text-[13px] text-ink/55">{t("language.label")}</span>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg border border-ink/10 bg-white/70 px-3 py-2 text-sm text-ink shadow-sm transition hover:border-gold/40"
        >
          <Globe size={15} strokeWidth={1.75} className="text-ink/60" />
          <span className="font-medium uppercase">{lang}</span>
          <ChevronDown
            size={14}
            strokeWidth={1.75}
            className={cn("text-ink/50 transition", open && "rotate-180")}
          />
        </button>

        {open && (
          <ul
            role="listbox"
            className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-ink/10 bg-white shadow-lg"
          >
            {LANGUAGES.map((option) => (
              <li key={option.code}>
                <button
                  type="button"
                  onClick={() => {
                    setLang(option.code as Lang);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-sm transition hover:bg-cream-50",
                    lang === option.code ? "text-gold" : "text-ink",
                  )}
                >
                  <span>{option.label}</span>
                  <span className="text-[11px] uppercase text-ink/40">
                    {option.code}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
